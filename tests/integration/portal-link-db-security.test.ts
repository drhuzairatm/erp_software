/**
 * Finding N-7, database security of migration 0036 (runs only against the throwaway test database):
 * EXECUTE permissions, fixed search_path and SECURITY DEFINER of every new function; no application-role access to the
 * secure queue; an EXACT rollback restoration test (rollback → compare with the pre-0036 definitions → re-apply); and the
 * migration's handling of legacy exposed links (scrubbed, open links invalidated, audited).
 */
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': 'vitest' }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}))

import { rollbackTo, runMigrations } from '../../scripts/lib/migrations'
import { hashToken } from '@/server/auth/tokens'
import { anonymous, db } from '@/server/db'
import { setPasswordWithLink } from '@/server/portal'
import * as pa from '@/server/services/portal-accounts'
import * as students from '@/server/services/students'
import { adminSql, ctxFor, orgId } from '../support/helpers'

afterAll(async () => { await adminSql().end(); await db().end() })

const APP_CALLABLE = ['portal_email_claim(integer)', 'portal_email_finish(uuid,text,text,text,text)', 'portal_email_housekeeping()', 'portal_email_status(uuid)']
const INTERNAL = ['portal_link_cipher_ok(text)', 'portal_token_revoke_email()', 'notification_messages_no_portal_links()']
const REPLACED = ['issue_portal_account_link(uuid,text,text)', 'portal_request_reset(text,text,text)', 'finish_notification(uuid,text,text,text,text,text,text,integer)']
// Pre-0036 definitions, fingerprinted from the development database (built by the same migration files) BEFORE 0036
// was applied: md5(pg_get_functiondef(...)) and the access list; for the policy md5(qual), roles and command.
const OLD_ACL = '{=X/postgres,postgres=X/postgres,erp_app=X/postgres}'
const PRE_0036: Record<string, { md5: string; acl: string | null }> = {
  'app.issue_portal_account_link(uuid,text,text)': { md5: '78cb9bae80b4d3260344eb1581c88ef4', acl: OLD_ACL },
  'app.portal_request_reset(text,text,text)': { md5: 'a6d07a10ab5f4a50cb62018335619a91', acl: OLD_ACL },
  'app.finish_notification(uuid,text,text,text,text,text,text,integer)': { md5: '865961e27aa7a2a3ebaba5e2f21b3b6d', acl: OLD_ACL },
}
const PRE_0036_POLICY = { m: '0cddff7df870a7c6bb9ba844bfc138fa', roles: '{erp_app}', permissive: 'PERMISSIVE', cmd: 'SELECT' }
const fingerprint = async (sig: string) => {
  const [r] = await adminSql()`select md5(pg_get_functiondef(${sig}::regprocedure)) as md5, (select proacl::text from pg_proc where oid = ${sig}::regprocedure) as acl`
  return r as { md5: string; acl: string | null }
}
const policy = async () => (await adminSql()`select md5(qual) as m, roles::text, permissive, cmd from pg_policies
                                             where tablename = 'notification_messages' and policyname = 'messages_select'`)[0]

describe('0036: EXECUTE permissions, search_path, least privilege', () => {
  it('every new function is SECURITY DEFINER with a fixed search_path; PUBLIC can execute none of them', async () => {
    for (const f of [...APP_CALLABLE, ...INTERNAL]) {
      const [p] = await adminSql()`select p.prosecdef, p.proconfig, p.proacl::text as acl, has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
                                     from pg_proc p where p.oid = ${'app.' + f}::regprocedure`
      expect(p.prosecdef, f).toBe(true)
      expect(p.proconfig, f).toEqual(['search_path=public, pg_temp'])
      expect(p.public_exec, f).toBe(false)
      expect(p.acl ?? '', f).not.toMatch(/(^|[{,])=X/)
    }
    // the replaced functions keep their definer rights, fixed search_path and their (unchanged) access list
    for (const f of REPLACED) {
      const [p] = await adminSql()`select p.prosecdef, p.proconfig, p.proacl::text as acl from pg_proc p where p.oid = ${'app.' + f}::regprocedure`
      expect(p, f).toMatchObject({ prosecdef: true, proconfig: ['search_path=public, pg_temp'], acl: OLD_ACL })
    }
  })

  it('erp_app may execute exactly the application functions, and none of the internal or trigger functions', async () => {
    for (const f of APP_CALLABLE) expect((await adminSql()`select has_function_privilege('erp_app', ${'app.' + f}::regprocedure, 'EXECUTE') as ok`)[0].ok, f).toBe(true)
    for (const f of INTERNAL) expect((await adminSql()`select has_function_privilege('erp_app', ${'app.' + f}::regprocedure, 'EXECUTE') as ok`)[0].ok, f).toBe(false)
    await expect(db()`select app.portal_link_cipher_ok('v1:a:b:c')`).rejects.toMatchObject({ code: '42501' })
  })

  it('the secure queue is closed to the application role: no schema usage, no table privilege, no grant', async () => {
    const [s] = await adminSql()`select has_schema_privilege('erp_app', 'auth_private', 'USAGE') as usage,
      has_table_privilege('erp_app', 'auth_private.portal_email_outbox', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as any,
      (select count(*)::int from information_schema.role_table_grants where table_schema = 'auth_private' and table_name = 'portal_email_outbox' and grantee in ('erp_app', 'PUBLIC')) as grants`
    expect(s).toEqual({ usage: false, any: false, grants: 0 })
    await expect(db()`select * from auth_private.portal_email_outbox limit 1`).rejects.toMatchObject({ code: '42501' })
  })

  it('only the approved policy changed: policy count and RLS tables unchanged; messages_select hides the two kinds from every branch', async () => {
    expect((await adminSql()`select count(*)::int as n from pg_policies where schemaname = 'public'`)[0].n).toBe(149)
    expect((await adminSql()`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`)[0].n).toBe(89)
    const [p] = await adminSql()`select qual, roles::text from pg_policies where tablename = 'notification_messages' and policyname = 'messages_select'`
    expect(p.roles).toBe('{erp_app}')
    // both portal-link kinds stay hidden; later migrations may hide more kinds (0037 adds the two authentication kinds, asserted
    // exactly in auth-message-db-security.test.ts)
    expect(p.qual).toMatch(/^\(\(event_key <> ALL \(ARRAY\['portal_account_setup'::text, 'portal_password_reset'::text(, '[a-z_]+'::text)*\]\)\) AND/)
  })
})

describe('0036: exact rollback restoration and legacy handling (isolated test database)', () => {
  it('rollback restores the replaced functions and policy exactly and removes every new object; re-applying scrubs exposed legacy links', async () => {
    const url = process.env.DATABASE_ADMIN_URL!
    const quiet = () => {}
    const applied = Object.fromEntries(await Promise.all(Object.keys(PRE_0036).map(async (k) => [k, await fingerprint(k)])))
    const appliedPolicy = await policy()
    expect(applied['app.issue_portal_account_link(uuid,text,text)'].md5).not.toBe(PRE_0036['app.issue_portal_account_link(uuid,text,text)'].md5)

    await rollbackTo(url, '0036', quiet)
    for (const [sig, want] of Object.entries(PRE_0036)) expect(await fingerprint(sig), sig).toEqual(want)
    expect(await policy()).toEqual(PRE_0036_POLICY)
    for (const f of [...APP_CALLABLE, ...INTERNAL]) expect((await adminSql()`select to_regprocedure(${'app.' + f}) as p`)[0].p, f).toBeNull()
    expect((await adminSql()`select to_regclass('auth_private.portal_email_outbox') as t`)[0].t).toBeNull()
    expect((await adminSql()`select count(*)::int as n from pg_trigger where tgname in ('student_account_tokens_revoke_email', 'notification_messages_no_portal_links')`)[0].n).toBe(0)
    expect((await adminSql()`select max(version) as v from schema_migrations`)[0].v).toBe('0035_auth_rate_limits.sql')

    // build a REAL legacy exposure with the restored pre-0036 function: an active account, a verified email, a reset link in the outbox
    const mgr = await ctxFor('edx.manager@demo.test')
    const n = String(Math.floor(Math.random() * 90000) + 10000)
    const r = await students.createStudent(mgr, { originatingOrgId: await orgId('EDX'), fullName: 'N7 Legacy Student', phone: `+91 90095 ${n}`, email: `n7.legacy.${n}@example.test` })
    if (!r.ok) throw new Error('duplicate')
    const first = (await pa.issuePortalLink(mgr, r.id)).link! // unverified → handed over; the old function accepts it
    await setPasswordWithLink(new URL(first).searchParams.get('token')!, 'Fictional-N7-Legacy-1!', 'Fictional-N7-Legacy-1!')
    await adminSql().begin(async (tx) => { await tx`select set_config('app.email_verify', 'on', true)`; await tx`update students set email_status = 'verified', email_verified_at = now() where id = ${r.id}` })
    const [s] = await adminSql()`select student_code from students where id = ${r.id}`
    const legacyToken = `LegacyN7Token${n}abcdefghijklmnopq`
    await anonymous((tx) => tx`select app.portal_request_reset(${s.student_code}, ${hashToken(legacyToken)}, ${'http://x/portal/password?token=' + legacyToken})`)
    const [m0] = await adminSql()`select id, status, params from notification_messages where student_id = ${r.id} and event_key = 'portal_password_reset'`
    expect(m0.status).toBe('queued')
    expect(JSON.stringify(m0.params)).toContain(legacyToken) // the exposure 0036 fixes
    expect((await anonymous((tx) => tx`select app.portal_link_check(${hashToken(legacyToken)}) as c`))[0].c).toBe(s.student_code)

    await runMigrations(url, { log: quiet })
    for (const [sig, want] of Object.entries(applied)) expect(await fingerprint(sig), sig).toEqual(want)
    expect(await policy()).toEqual(appliedPolicy)
    // legacy handling: message scrubbed and never sent, the exposed link no longer works, the action is in the audit log
    const [m1] = await adminSql()`select status, skip_reason, params, body from notification_messages where id = ${m0.id}`
    expect(m1.status).toBe('skipped')
    expect(m1.skip_reason).toMatch(/N-7/)
    expect(JSON.stringify(m1)).not.toContain(legacyToken)
    expect((await anonymous((tx) => tx`select app.portal_link_check(${hashToken(legacyToken)}) as c`))[0].c).toBeNull()
    const [a] = await adminSql()`select metadata from audit_logs where action = 'portal_links_invalidated' order by id desc limit 1`
    expect(a.metadata.links_invalidated).toBeGreaterThanOrEqual(1)
    expect(a.metadata.messages_scrubbed).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(a)).not.toContain(legacyToken)
  })
})
