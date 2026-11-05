/**
 * PROPOSED ONLY. Goes to backend/tests/integration/ if Stages A and B are approved; it fails until then.
 * Permanent guard for the permission change, run on the throwaway test database.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { adminSql } from '../support/helpers'

afterAll(async () => { await adminSql().end(); await db().end() })

describe('privileged functions', () => {
  it('no SECURITY DEFINER function in app is executable by PUBLIC', async () => {
    const rows = await adminSql()`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.prosecdef and has_function_privilege('public', p.oid, 'execute')`
    expect(rows.map((r) => r.sig)).toEqual([])
  })

  it('every app function belongs to the role that runs migrations', async () => {
    const [{ me }] = await adminSql()`select current_user as me`
    const rows = await adminSql()`select distinct pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app'`
    expect(rows.map((r) => r.owner)).toEqual([me])
  })

  it('the default privilege is in place for the migration role, across all schemas', async () => {
    const [{ me }] = await adminSql()`select current_user as me`
    const rows = await adminSql()`select defaclrole::regrole::text as role, defaclnamespace, defaclacl::text as acl from pg_default_acl where defaclobjtype = 'f' and defaclnamespace = 0`
    expect(rows).toHaveLength(1)
    expect(rows[0].role).toBe(me)
    expect(rows[0].acl).not.toMatch(/(^|[{,])=X/)
  })

  it('a function created in a future migration starts with no access; dropping and recreating loses a grant', async () => {
    await adminSql().begin(async (tx) => {
      await tx.unsafe(`create function app.__guard_probe() returns int language sql security definer set search_path = public, pg_temp as 'select 1'`)
      const check = async () => (await tx`select has_function_privilege('public', 'app.__guard_probe()', 'execute') as pub, has_function_privilege('erp_app', 'app.__guard_probe()', 'execute') as erp`)[0]
      expect(await check()).toEqual({ pub: false, erp: false })
      await tx.unsafe(`grant execute on function app.__guard_probe() to erp_app`)
      await tx.unsafe(`create or replace function app.__guard_probe() returns int language sql security definer set search_path = public, pg_temp as 'select 2'`)
      expect(await check()).toEqual({ pub: false, erp: true })
      await tx.unsafe(`drop function app.__guard_probe()`)
      await tx.unsafe(`create function app.__guard_probe() returns int language sql security definer set search_path = public, pg_temp as 'select 3'`)
      expect(await check()).toEqual({ pub: false, erp: false })
      await tx.unsafe(`select 1/0`).catch(() => {}) // the failed statement aborts the transaction, so nothing above is kept
    }).catch(() => {})
    const [r] = await adminSql()`select to_regprocedure('app.__guard_probe()') as p`
    expect(r.p).toBeNull()
  })

  it('an extension installed after Stage A also loses PUBLIC access to its functions, so it needs an explicit grant', async () => {
    await adminSql().begin(async (tx) => {
      await tx.unsafe('create extension btree_gist')
      const [r] = await tx`select count(*)::int as total, count(*) filter (where has_function_privilege('public', p.oid, 'execute'))::int as pub
        from pg_proc p join pg_depend d on d.objid = p.oid and d.deptype = 'e' join pg_extension e on e.oid = d.refobjid where e.extname = 'btree_gist'`
      expect(r.total).toBeGreaterThan(0)
      expect(r.pub).toBe(0)
      throw new Error('undo')
    }).catch((e: Error) => { if (e.message !== 'undo') throw e })
  })
})
