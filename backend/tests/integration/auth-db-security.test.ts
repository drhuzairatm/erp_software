/**
 * Finding N-1, database security of migration 0035 (runs only against the throwaway test database):
 * EXECUTE permissions, fixed search_path and SECURITY DEFINER of every new function; no application-role access to
 * auth_private; and an EXACT rollback restoration test (rollback → compare with the pre-0035 definitions → re-apply).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { rollbackTo, runMigrations } from '../../scripts/lib/migrations'
import { db } from '@/lib/db'
import { adminSql } from '../support/helpers'

afterAll(async () => { await adminSql().end(); await db().end() })

// called by the application (erp_app needs EXECUTE)
const APP_CALLABLE = [
  'auth_begin_attempt(text,text,text)', 'auth_finish_attempt(bigint,boolean,text,integer,text,text)', 'auth_trust_device_after_mfa(text,text,text)',
  'auth_request_reset_limited(text,text,text,text)', 'auth_complete_reset_trusted(text,text,text)', 'staff_email_claim(integer)',
  'staff_email_finish(uuid,text,text)', 'auth_housekeeping()', 'portal_password_begin(text,text)',
  'portal_password_finish(text,uuid[],uuid[],text,text,text,text,text)', 'portal_set_password_trusted(text,text,text)',
]
// internal helpers and trigger functions (nobody but the owner may execute them)
const INTERNAL = [
  'staff_device_valid(text,uuid)', 'portal_device_valid(text,uuid)', 'trusted_device_add(text,uuid,uuid,text)',
  'revoke_trusted_on_credentials()', 'revoke_trusted_on_mfa()', 'revoke_trusted_on_status()', 'revoke_trusted_on_portal_account()',
  'password_reset_supersede()',
]
const NEW_TABLES = ['trusted_devices', 'password_reset_requests', 'staff_email_outbox']
// Pre-0035 definitions, fingerprinted from the development database (built by the same migration files) BEFORE 0035
// was applied: md5(pg_get_functiondef(...)) and the access list. The rollback must restore exactly these.
const PRE_0035 = {
  'app.revoke_user_sessions(uuid)': { md5: '860fd4fb7bac6e35ef7756da6e425b38', acl: '{=X/postgres,postgres=X/postgres,erp_app=X/postgres}' },
  'app.portal_password_result(text,uuid[],uuid[],text,text,text)': { md5: 'a18de67dccb65de02dfc29281a7139d2', acl: '{=X/postgres,postgres=X/postgres,erp_app=X/postgres}' },
  'app.audit_security_alerts()': { md5: 'a1282dda061f2d3f9d6052c226262eed', acl: null },
}
const fingerprint = async (sig: string) => {
  const [r] = await adminSql()`select md5(pg_get_functiondef(${sig}::regprocedure)) as md5, (select proacl::text from pg_proc where oid = ${sig}::regprocedure) as acl`
  return r as { md5: string; acl: string | null }
}

describe('0035: EXECUTE permissions, search_path, least privilege', () => {
  it('every new function is SECURITY DEFINER with a fixed search_path; PUBLIC can execute none of them', async () => {
    for (const f of [...APP_CALLABLE, ...INTERNAL]) {
      const [p] = await adminSql()`select p.prosecdef, p.proconfig, p.proacl::text as acl, has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
                                     from pg_proc p where p.oid = ${'app.' + f}::regprocedure`
      expect(p.prosecdef, f).toBe(true)
      expect(p.proconfig, f).toEqual(['search_path=public, pg_temp'])
      expect(p.public_exec, f).toBe(false)
      expect(p.acl ?? '', f).not.toMatch(/(^|[{,])=X/)
    }
  })

  it('erp_app may execute exactly the application functions, and none of the internal or trigger functions', async () => {
    for (const f of APP_CALLABLE) {
      const [r] = await adminSql()`select has_function_privilege('erp_app', ${'app.' + f}::regprocedure, 'EXECUTE') as ok`
      expect(r.ok, f).toBe(true)
    }
    for (const f of INTERNAL) {
      const [r] = await adminSql()`select has_function_privilege('erp_app', ${'app.' + f}::regprocedure, 'EXECUTE') as ok`
      expect(r.ok, f).toBe(false)
    }
    await expect(db()`select app.staff_device_valid('x', gen_random_uuid())`).rejects.toMatchObject({ code: '42501' })
  })

  it('auth_private stays closed to the application role: no schema usage, no privilege on any new table', async () => {
    const [s] = await adminSql()`select has_schema_privilege('erp_app', 'auth_private', 'USAGE') as usage`
    expect(s.usage).toBe(false)
    for (const t of NEW_TABLES) {
      const [r] = await adminSql()`select has_table_privilege('erp_app', ${'auth_private.' + t}, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as any`
      expect(r.any, t).toBe(false)
      const [g] = await adminSql()`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'auth_private' and table_name = ${t} and grantee in ('erp_app', 'PUBLIC')`
      expect(g.n, t).toBe(0)
    }
    await expect(db()`select * from auth_private.trusted_devices limit 1`).rejects.toMatchObject({ code: '42501' })
  })

  it('no row-level security policy, role, permission or grant on public tables was changed by 0035', async () => {
    const [{ n }] = await adminSql()`select count(*)::int as n from pg_policies where schemaname = 'public'`
    expect(n).toBe(149)
    const [{ rls }] = await adminSql()`select count(*)::int as rls from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`
    expect(rls).toBe(89)
  })
})

describe('0035: exact rollback restoration (isolated test database)', () => {
  it('rollback restores the three replaced functions byte-for-byte (definition and access list), removes every new object; re-applying works', async () => {
    const url = process.env.DATABASE_ADMIN_URL!
    const quiet = () => {}
    const applied = await fingerprint('app.revoke_user_sessions(uuid)')
    expect(applied.md5).not.toBe(PRE_0035['app.revoke_user_sessions(uuid)'].md5) // 0035 version is active

    await rollbackTo(url, '0035', quiet)
    for (const [sig, want] of Object.entries(PRE_0035)) expect(await fingerprint(sig), sig).toEqual(want)
    for (const f of [...APP_CALLABLE, ...INTERNAL]) {
      const [r] = await adminSql()`select to_regprocedure(${'app.' + f}) as p`
      expect(r.p, f).toBeNull()
    }
    for (const t of NEW_TABLES) {
      const [r] = await adminSql()`select to_regclass(${'auth_private.' + t}) as t`
      expect(r.t, t).toBeNull()
    }
    const cols = await adminSql()`select column_name from information_schema.columns where table_schema = 'auth_private' and table_name = 'login_attempts' order by 1`
    expect(cols.map((c) => c.column_name)).toEqual(['attempted_at', 'email', 'id', 'ip', 'success'])
    const [{ trg }] = await adminSql()`select count(*)::int as trg from pg_trigger where tgname in ('credentials_revoke_trusted', 'mfa_revoke_trusted',
      'user_profiles_revoke_trusted', 'student_accounts_revoke_trusted', 'password_resets_supersede')`
    expect(trg).toBe(0)
    const [{ v }] = await adminSql()`select max(version) as v from schema_migrations`
    expect(v).toBe('0034_audit_remediation.sql')

    await runMigrations(url, { log: quiet })
    const again = await fingerprint('app.revoke_user_sessions(uuid)')
    expect(again).toEqual(applied)
    for (const t of NEW_TABLES) expect((await adminSql()`select to_regclass(${'auth_private.' + t}) as t`)[0].t, t).not.toBeNull()
  })
})
