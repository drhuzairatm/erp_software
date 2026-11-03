/**
 * Finding N-8, database security of migration 0037 (runs only against the throwaway test database):
 * EXECUTE permissions, fixed search_path and SECURITY DEFINER of every new function; the secure queue closed to the
 * application role; the database's format and final-state guards; an EXACT rollback restoration test (rollback →
 * compare with the pre-0037 definitions → re-apply); and the migration's handling of legacy exposed codes / links.
 * Fictional data only; codes and links are never printed.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': 'vitest' }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}))

import { createHmac, randomBytes } from 'node:crypto'
import { rollbackTo, runMigrations } from '../../scripts/lib/migrations'
import { encryptAuthSecret } from '@/lib/auth/auth-message-crypto'
import { encryptSecret } from '@/lib/auth/mfa'
import { hashToken } from '@/lib/auth/tokens'
import { anonymous, db } from '@/lib/db'
import { processQueue } from '@/lib/notifications/dispatcher'
import * as pp from '@/services/passport'
import * as students from '@/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../support/helpers'

afterAll(async () => { await adminSql().end(); await db().end() })

const APP_CALLABLE = ['auth_message_claim(integer)', 'auth_message_finish(uuid,text,text,text,text)', 'auth_message_housekeeping()',
  'auth_message_log(uuid[],uuid,text,text,text,integer)']
const INTERNAL = ['auth_secret_cipher_ok(text)', 'auth_mask_error(text)', 'auth_challenge_revoke_message()', 'auth_verification_revoke_message()',
  'auth_contact_revoke_message()', 'notification_messages_no_auth_secrets()']
const REPLACED = ['portal_request_code(text,text,text,text)', 'request_email_verification(uuid,text,text)']
const TRIGGERS = ['portal_challenges_revoke_message', 'email_verifications_revoke_message', 'students_revoke_auth_messages', 'notification_messages_no_auth_secrets']
// Pre-0037 definitions, fingerprinted from the development database (built by the same migration files) BEFORE 0037
// was applied: md5(pg_get_functiondef(...)) and the access list; for the policy md5(qual), roles and command.
const OLD_ACL = '{=X/postgres,postgres=X/postgres,erp_app=X/postgres}'
const PRE_0037: Record<string, { md5: string; acl: string | null }> = {
  'app.portal_request_code(text,text,text,text)': { md5: 'df1d4fddd8a4da49b53688ea8c155635', acl: OLD_ACL },
  'app.request_email_verification(uuid,text,text)': { md5: 'f9a5d66c0639a5125fd9c1230934a63c', acl: OLD_ACL },
}
const PRE_0037_POLICY = { m: '21e689f55ec3dd2dce963c3e8e08a129', roles: '{erp_app}', permissive: 'PERMISSIVE', cmd: 'SELECT' }
const fingerprint = async (sig: string) => {
  const [r] = await adminSql()`select md5(pg_get_functiondef(${sig}::regprocedure)) as md5, (select proacl::text from pg_proc where oid = ${sig}::regprocedure) as acl`
  return r as { md5: string; acl: string | null }
}
const policy = async () => (await adminSql()`select md5(qual) as m, roles::text, permissive, cmd from pg_policies
                                             where tablename = 'notification_messages' and policyname = 'messages_select'`)[0]
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const hmac = (v: string) => createHmac('sha256', process.env.STORAGE_SIGNING_SECRET!).update(v).digest('hex')

describe('0037: EXECUTE permissions, search_path, least privilege', () => {
  it('every new function is SECURITY DEFINER with a fixed search_path; PUBLIC can execute none of them', async () => {
    for (const f of [...APP_CALLABLE, ...INTERNAL]) {
      const [p] = await adminSql()`select p.prosecdef, p.proconfig, p.proacl::text as acl, has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
                                     from pg_proc p where p.oid = ${'app.' + f}::regprocedure`
      expect(p.prosecdef, f).toBe(true)
      expect(p.proconfig, f).toEqual(['search_path=public, pg_temp'])
      expect(p.public_exec, f).toBe(false)
      expect(p.acl ?? '', f).not.toMatch(/(^|[{,])=X/)
    }
    for (const f of REPLACED) {
      const [p] = await adminSql()`select p.prosecdef, p.proconfig, p.proacl::text as acl from pg_proc p where p.oid = ${'app.' + f}::regprocedure`
      expect(p, f).toMatchObject({ prosecdef: true, proconfig: ['search_path=public, pg_temp'], acl: OLD_ACL })
    }
  })

  it('erp_app may execute exactly the application functions, and none of the internal or trigger functions', async () => {
    for (const f of APP_CALLABLE) expect((await adminSql()`select has_function_privilege('erp_app', ${'app.' + f}::regprocedure, 'EXECUTE') as ok`)[0].ok, f).toBe(true)
    for (const f of INTERNAL) expect((await adminSql()`select has_function_privilege('erp_app', ${'app.' + f}::regprocedure, 'EXECUTE') as ok`)[0].ok, f).toBe(false)
    await expect(db()`select app.auth_mask_error('x')`).rejects.toMatchObject({ code: '42501' })
  })

  it('the secure queue is closed to the application role: no schema usage, no table privilege, no grant', async () => {
    const [s] = await adminSql()`select has_schema_privilege('erp_app', 'auth_private', 'USAGE') as usage,
      has_table_privilege('erp_app', 'auth_private.auth_message_outbox', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as any,
      (select count(*)::int from information_schema.role_table_grants where table_schema = 'auth_private' and table_name = 'auth_message_outbox' and grantee in ('erp_app', 'PUBLIC')) as grants`
    expect(s).toEqual({ usage: false, any: false, grants: 0 })
    await expect(db()`select * from auth_private.auth_message_outbox limit 1`).rejects.toMatchObject({ code: '42501' })
  })

  it('only the approved policy changed: policy count and RLS tables unchanged; all four authentication kinds hidden from every branch', async () => {
    expect((await adminSql()`select count(*)::int as n from pg_policies where schemaname = 'public'`)[0].n).toBe(149)
    expect((await adminSql()`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`)[0].n).toBe(89)
    const [p] = await adminSql()`select qual, roles::text from pg_policies where tablename = 'notification_messages' and policyname = 'messages_select'`
    expect(p.roles).toBe('{erp_app}')
    expect(p.qual).toMatch(/^\(\(event_key <> ALL \(ARRAY\['portal_account_setup'::text, 'portal_password_reset'::text, 'portal_login_code'::text, 'email_verification'::text\]\)\) AND/)
  })

  it('the database rejects plain secrets, other cipher formats and secrets left in a final state (shape only: decryption is checked by the server)', async () => {
    await expectDbError(anonymous((tx) => tx`select app.portal_request_code(${'x' + rand() + '@example.test'}, '123456', ${hmac('123456')}, null)`), '22023')
    // an N-1 / N-7 cipher text (other key usage) is not accepted either
    await expectDbError(anonymous((tx) => tx`select app.portal_request_code(${'x' + rand() + '@example.test'}, ${encryptSecret('123456')}, ${hmac('123456')}, null)`), '22023')
    await expectDbError(anonymous((tx) => tx`select app.portal_request_code(${'x' + rand() + '@example.test'}, 'am1:short:x:y', ${hmac('1')}, null)`), '22023')
    const ok = encryptAuthSecret('portal_login_code', '123456')
    expect((await adminSql()`select app.auth_secret_cipher_ok(${ok}) as ok`)[0].ok).toBe(true)
  })
})

describe('0037: exact rollback restoration and legacy handling (isolated test database)', () => {
  it('rollback restores the replaced functions and policy exactly and removes every new object; re-applying scrubs exposed legacy codes and links', async () => {
    const url = process.env.DATABASE_ADMIN_URL!
    const quiet = () => {}
    const applied = Object.fromEntries(await Promise.all(Object.keys(PRE_0037).map(async (k) => [k, await fingerprint(k)])))
    const appliedPolicy = await policy()

    await rollbackTo(url, '0037', quiet)
    for (const [sig, want] of Object.entries(PRE_0037)) expect(await fingerprint(sig), sig).toEqual(want)
    expect(await policy()).toEqual(PRE_0037_POLICY)
    for (const f of [...APP_CALLABLE, ...INTERNAL]) expect((await adminSql()`select to_regprocedure(${'app.' + f}) as p`)[0].p, f).toBeNull()
    expect((await adminSql()`select to_regclass('auth_private.auth_message_outbox') as t`)[0].t).toBeNull()
    expect((await adminSql()`select count(*)::int as n from pg_trigger where tgname = any(${TRIGGERS})`)[0].n).toBe(0)
    expect((await adminSql()`select max(version) as v from schema_migrations`)[0].v).toBe('0036_portal_link_queue.sql')

    // a REAL legacy exposure with the restored pre-0037 functions: a plain code and a plain verification link in the outbox,
    // rendered in test mode (code in subject and body), exactly as before the fix
    const mgr = await ctxFor('edx.manager@demo.test')
    const n = rand()
    const email = `n8.legacy.${n}${rand()}@example.test`
    const r = await students.createStudent(mgr, { originatingOrgId: await orgId('EDX'), fullName: 'N8 Legacy Student', phone: `+91 90096 ${n}`, email })
    if (!r.ok) throw new Error('duplicate')
    const code = String(100000 + Math.floor(Math.random() * 899999))
    const [{ id: challenge }] = await anonymous((tx) => tx<{ id: string }[]>`select app.portal_request_code(${email}, ${code}, ${hmac(code)}, null) as id`)
    const vtoken = randomBytes(24).toString('base64url')
    await as('edx.manager@demo.test', (tx) => tx`select app.request_email_verification(${r.id}, ${hashToken(vtoken)}, ${'http://x/verify-email?token=' + vtoken})`)
    process.env.NOTIFICATIONS_MODE = 'test'
    await processQueue(200)
    const before = await adminSql()`select id, event_key, status, subject, body, params from notification_messages where student_id = ${r.id} and event_key in ('portal_login_code', 'email_verification')`
    expect(before).toHaveLength(2)
    expect(before.every((m) => m.status === 'test')).toBe(true)
    expect(JSON.stringify(before)).toContain(code) // the exposure 0037 fixes (params, body and subject)
    expect(before.find((m) => m.event_key === 'portal_login_code')!.subject).toContain(code)
    expect(JSON.stringify(before)).toContain(vtoken)

    await runMigrations(url, { log: quiet })
    for (const [sig, want] of Object.entries(applied)) expect(await fingerprint(sig), sig).toEqual(want)
    expect(await policy()).toEqual(appliedPolicy)
    const after = await adminSql()`select status, subject, body, params from notification_messages where id = any(${before.map((m) => m.id)})`
    expect(JSON.stringify(after)).not.toContain(code)
    expect(JSON.stringify(after)).not.toContain(vtoken)
    expect(after.every((m) => m.status === 'test')).toBe(true) // status history kept
    // the exposed code and link no longer work
    const [v] = await anonymous((tx) => tx<{ ok: boolean }[]>`select * from app.portal_verify_code(${challenge}, ${hmac(code)}, ${hmac('t' + rand())}, '127.0.0.1', 'test')`)
    expect(v.ok).toBe(false)
    expect(await pp.confirmEmailVerification(vtoken)).toBe('invalid')
    const [a] = await adminSql()`select metadata from audit_logs where action = 'auth_secrets_invalidated' order by id desc limit 1`
    expect(a.metadata.codes_invalidated).toBeGreaterThanOrEqual(1)
    expect(a.metadata.links_invalidated).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(a)).not.toContain(code)
    // legacy rows can no longer be re-queued (Retry) nor new ones inserted
    await expectDbError(as('edx.manager@demo.test', (tx) => tx`select app.retry_notification(${before[0].id})`), '23514')
    await expectDbError(adminSql()`insert into notification_messages (org_id, student_id, event_key, channel, recipient_type, to_address, params, status)
      values (${await orgId('EDX')}, ${r.id}, 'portal_login_code', 'email', 'student', ${email}, ${adminSql().json({ code })}, 'queued')`, '42501')
  })
})
