/**
 * Company data isolation enforced by the DATABASE itself (row-level security),
 * tested directly as the low-privilege application role. These tests deliberately
 * bypass the application code: even raw SQL with guessed ids must not leak.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/server/db'
import { adminSql, as, expectDbError, orgId, studentWhere } from '../support/helpers'

afterAll(async () => {
  await adminSql().end()
  await db().end()
})

describe('row-level security: company isolation', () => {
  it('returns nothing without an authenticated user context', async () => {
    const rows = await db()`select count(*)::int as n from v_students`
    expect(rows[0].n).toBe(0)
    const tasks = await db()`select count(*)::int as n from tasks`
    expect(tasks[0].n).toBe(0)
  })

  it('a GRADUATER counsellor sees only GRADUATER students', async () => {
    const rows = await as('grd.counsellor@demo.test', (tx) => tx`
      select distinct o.code from v_students s join organizations o on o.id = s.originating_org_id`)
    expect(rows.map((r) => r.code)).toEqual(['GRD'])
  })

  it('an Edulinks counsellor cannot see GRADUATER students, even those Edulinks processes', async () => {
    const grd = await studentWhere(`o.code = 'GRD'`)
    const rows = await as('edx.counsellor@demo.test', (tx) => tx`select id from v_students where id = ${grd.id}`)
    expect(rows).toHaveLength(0)
    const base = await as('edx.counsellor@demo.test', (tx) => tx`select id from students where id = ${grd.id}`)
    expect(base).toHaveLength(0)
  })

  it('guessed ids for another company return no rows across child tables', async () => {
    const edx = await studentWhere(`o.code = 'EDX' and s.current_stage_key not in ('lead','registration')`)
    const res = await as('grd.manager@demo.test', async (tx) => ({
      docs: await tx`select id from student_documents where student_id = ${edx.id}`,
      tasks: await tx`select id from tasks where student_id = ${edx.id}`,
      pays: await tx`select id from payment_entries where student_id = ${edx.id}`,
      events: await tx`select id from student_events where student_id = ${edx.id}`,
      hist: await tx`select id from student_stage_history where student_id = ${edx.id}`,
      notes: await tx`select id from followups where student_id = ${edx.id}`,
    }))
    for (const [k, v] of Object.entries(res)) expect(v, k).toHaveLength(0)
  })

  it('updates to another company\'s student affect zero rows', async () => {
    const edx = await studentWhere(`o.code = 'EDX'`)
    const r = await as('grd.manager@demo.test', (tx) => tx`update students set full_name = 'Hacked' where id = ${edx.id}`)
    expect(r.count).toBe(0)
    const [check] = await adminSql()`select full_name from students where id = ${edx.id}`
    expect(check.full_name).not.toBe('Hacked')
  })

  it('cannot insert a student into a company the user does not belong to', async () => {
    await expectDbError(as('grd.counsellor@demo.test', async (tx) => tx`
      insert into students (id, originating_org_id, full_name, phone) values (gen_random_uuid(), ${await orgId('EDX')}, 'Intruder Test', '+91 90000 99999')`), '42501')
  })

  it('cannot create a task or payment in another company', async () => {
    const edxOrg = await orgId('EDX')
    await expectDbError(as('grd.manager@demo.test', (tx) => tx`
      insert into tasks (id, org_id, title) values (gen_random_uuid(), ${edxOrg}, 'Cross-company task')`), '42501')
    const grdStudent = await studentWhere(`o.code = 'GRD'`)
    const [fee] = await adminSql()`select id from fee_categories where org_id = ${edxOrg} limit 1`
    await expectDbError(as('grd.finance@demo.test', (tx) => tx`
      insert into payment_entries (id, org_id, student_id, entry_type, fee_category_id, amount)
      values (gen_random_uuid(), ${edxOrg}, ${grdStudent.id}, 'charge', ${fee.id}, 100)`), '42501')
  })

  it('contact details cannot be read from the base table, and are masked without permission', async () => {
    await expectDbError(as('edx.manager@demo.test', (tx) => tx`select phone from students limit 1`), '42501')
    const rows = await as('edx.finance@demo.test', (tx) => tx`select phone, email, phone_masked, contact_visible from v_students limit 3`)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.contact_visible).toBe(false)
      expect(r.phone).toBeNull()
      expect(r.email).toBeNull()
      expect(r.phone_masked).toMatch(/^••••••\d\d$/)
    }
  })

  it('storage keys of document files are never readable by the application role', async () => {
    await expectDbError(as('edx.manager@demo.test', (tx) => tx`select storage_key from document_files limit 1`), '42501')
  })

  it('documentation staff only see students assigned to them', async () => {
    const visible = await as('docs@demo.test', (tx) => tx`select id from v_students`)
    const [{ n }] = await adminSql()`select count(distinct a.student_id)::int as n from student_assignments a
      join user_profiles u on u.id = a.user_id where u.email = 'docs@demo.test' and a.is_active`
    expect(visible.length).toBe(n)
    expect(n).toBeGreaterThan(0)
  })

  it('Edulinks processing staff can see GRADUATER students assigned to them (shared processing)', async () => {
    const rows = await as('docs@demo.test', (tx) => tx`
      select distinct o.code from v_students s join organizations o on o.id = s.originating_org_id`)
    expect(rows.map((r) => r.code).sort()).toEqual(['EDX', 'GRD'])
  })

  it('system administrators do not get student records by default', async () => {
    const rows = await as('admin@demo.test', (tx) => tx`select count(*)::int as n from v_students`)
    expect(rows[0].n).toBe(0)
  })

  it('the MD with both memberships sees both companies', async () => {
    const rows = await as('md@demo.test', (tx) => tx`
      select distinct o.code from v_students s join organizations o on o.id = s.originating_org_id order by 1`)
    expect(rows.map((r) => r.code)).toEqual(['EDX', 'GRD'])
  })

  it('a role in one company does not grant permissions in the other', async () => {
    // grd.manager is a manager in GRD only
    const [r] = await as('grd.manager@demo.test', async (tx) => tx`
      select app.has_perm(${await orgId('GRD')}, 'students.update') as grd, app.has_perm(${await orgId('EDX')}, 'students.update') as edx`)
    expect(r).toEqual({ grd: true, edx: false })
  })

  it('audit log entries cannot be modified or deleted, even by the owner', async () => {
    await expectDbError(adminSql()`update audit_logs set action = 'x' where id = (select min(id) from audit_logs)`, 'P0001')
    await expectDbError(adminSql()`delete from audit_logs where id = (select min(id) from audit_logs)`, 'P0001')
    await expectDbError(as('md@demo.test', (tx) => tx`delete from audit_logs`), '42501')
  })

  it('users cannot grant permissions to a role they hold themselves', async () => {
    const [role] = await adminSql()`select r.id from roles r join organizations o on o.id = r.org_id where o.code = 'EDX' and r.key = 'system_admin'`
    await expectDbError(as('admin@demo.test', (tx) => tx`
      insert into role_permissions (role_id, permission_key) values (${role.id}, 'students.read.all')`), '42501')
  })

  it('users cannot change their own membership', async () => {
    const r = await as('admin@demo.test', async (tx) => tx`
      update organization_memberships set is_active = false where user_id = app.current_user_id()`)
    expect(r.count).toBe(0)
  })
})
