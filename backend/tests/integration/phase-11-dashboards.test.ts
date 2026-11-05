/** Phase 11: every dashboard and report number is checked against the rows behind it, with role and company limits. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import { managementAnalytics, teamAndOperations } from '@/services/analytics'
import * as reports from '@/services/reports'
import * as students from '@/services/students'
import { adminSql, as, ctxFor, orgId, userId } from '../support/helpers'

let EDX: string; let GRD: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const today = () => new Date().toISOString().slice(0, 10)
beforeAll(async () => {
  EDX = await orgId('EDX'); GRD = await orgId('GRD')
  // This database is built moments earlier and has never been analysed. Without statistics the analytics queries took 12.6 s instead of 0.9 s.
  await adminSql()`analyze`
})
afterAll(async () => { await adminSql().end(); await db().end() })
const find = (rows: Record<string, unknown>[], k: Record<string, unknown>) => rows.find((r) => Object.entries(k).every(([a, b]) => r[a] === b))
async function kindOf(p: Promise<unknown>) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); return (e as ServiceError).kind }
  throw new Error('expected ServiceError')
}

describe('Phase 11 admissions', () => {
  it('university and intake counts match the rows; adding one student moves each by exactly one', async () => {
    const md = await ctxFor('md@demo.test'); const mgr = await ctxFor('edx.manager@demo.test'); const sql = adminSql()
    const [uni] = await sql`select id, name, country_id from universities where is_active limit 1`
    const name = `Fictional Intake ${rand()}`
    const [intake] = await sql`insert into university_intakes (university_id, name, application_deadline) values (${uni.id}, ${name}, current_date + 10) returning id`
    const before = await managementAnalytics(md, [EDX], {})
    const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Fictional Admissions', phone: `+91 90071 ${rand()}` })
    if (!r.ok) throw new Error('student not created')
    await sql`update students set destination_country_id = ${uni.country_id}, intake_id = ${intake.id}, preferred_university_id = ${uni.id} where id = ${r.id}`
    const after = await managementAnalytics(md, [EDX], {})
    expect(after.kpis.total).toBe(before.kpis.total + 1)
    expect(after.byIntake.find((x) => x.label === name)?.value).toBe(1)
    const u0 = before.byUniversity.find((x) => x.label === uni.name)?.value ?? 0
    expect(after.byUniversity.find((x) => x.label === uni.name)?.value).toBe(u0 + 1)

    const rows = (await reports.runReport(md, 'by-intake', [EDX], {})).rows
    expect(find(rows, { intake: name, university: uni.name })).toMatchObject({ active: 1, total: 1 })
    expect((await reports.runReport(md, 'by-intake', [GRD], {})).rows.some((x) => x.intake === name)).toBe(false)
    const team = await teamAndOperations(md, [EDX])
    expect(team.deadlines.find((d) => d.id === intake.id)).toMatchObject({ intake: name, students: 1 })
  })
})

describe('Phase 11 employee', () => {
  it('attendance today and the summary agree with records; no record stays apart from a recorded absence', async () => {
    const md = await ctxFor('md@demo.test'); const sql = adminSql()
    const [late, absent, leave] = await Promise.all(['edx.counsellor@demo.test', 'edx.counsellor2@demo.test', 'docs@demo.test'].map(userId))
    await sql`delete from attendance_events where org_id = ${EDX}`.catch(() => undefined)
    await sql`delete from attendance_records where org_id = ${EDX} and work_date = current_date`.catch(() => undefined)
    const d = (await sql`select (now() at time zone 'Asia/Kolkata')::date::text as d`)[0].d
    await sql`insert into attendance_records (org_id, user_id, work_date, status, late_minutes) values (${EDX}, ${late}, ${d}, 'late', 20), (${EDX}, ${absent}, ${d}, 'absent', 0), (${EDX}, ${leave}, ${d}, 'leave', 0)`
    const [{ dow }] = await sql`select extract(dow from ${d}::date)::int as dow`
    const [{ members }] = await sql`select count(*)::int as members from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active where m.org_id = ${EDX} and m.is_active`
    const [policy] = await sql`select weekly_off from attendance_policies where org_id = ${EDX}`
    const working = !(policy?.weekly_off ?? [0]).includes(dow)
    const row = (await teamAndOperations(md, [EDX])).attendance[0]
    expect(row).toMatchObject({ expected: working ? members : 0, present: 1, late: 1, on_leave: 1, absent: 1, no_record: working ? members - 3 : 0 })

    const summary = (await reports.runReport(md, 'attendance-summary', [EDX], { from: d, to: d })).rows
    const counsellor = find(summary, { staff: (await sql`select full_name from user_profiles where id = ${late}`)[0].full_name })!
    expect(counsellor).toMatchObject({ present: 1, late: 1, absent: 0, no_record: 0 })
    const other = find(summary, { staff: (await sql`select full_name from user_profiles where id = ${absent}`)[0].full_name })!
    expect(other).toMatchObject({ present: 0, absent: 1, no_record: 0 })
  })

  it('task report counts open, overdue and completed for the right person and company; department filter narrows', async () => {
    const md = await ctxFor('md@demo.test'); const sql = adminSql()
    const user = await userId('edx.counsellor2@demo.test')
    const [{ full_name }] = await sql`select full_name from user_profiles where id = ${user}`
    const count = async () => find((await reports.runReport(md, 'employee-tasks', [EDX], {})).rows, { staff: full_name }) as { open: number; overdue: number }
    const before = await count()
    const mgr = await userId('edx.manager@demo.test')
    await sql`insert into tasks (org_id, title, assigned_to, created_by, due_date) values (${EDX}, 'Fictional overdue', ${user}, ${mgr}, current_date - 2), (${EDX}, 'Fictional later', ${user}, ${mgr}, current_date + 2)`
    const after = await count()
    expect(after.open).toBe(before.open + 2)
    expect(after.overdue).toBe(before.overdue + 1)
    const [dept] = await sql`insert into departments (org_id, name) values (${EDX}, ${`Fictional ${rand()}`}) returning id`
    await sql`update organization_memberships set department_id = ${dept.id} where org_id = ${EDX} and user_id = ${user}`
    const narrowed = (await reports.runReport(md, 'employee-tasks', [EDX], { department: dept.id })).rows
    expect(narrowed.map((x) => x.staff)).toEqual([full_name])
    expect((await reports.runReport(md, 'attendance-summary', [EDX], { department: dept.id })).rows.map((x) => x.staff)).toEqual([full_name])
    await sql`update organization_memberships set department_id = null where org_id = ${EDX} and user_id = ${user}`
    expect((await reports.runReport(md, 'employee-tasks', [EDX], { department: 'not-a-uuid' })).rows.length).toBeGreaterThan(1)
  })

  it('a long or odd date range is limited and cannot break the report', async () => {
    const md = await ctxFor('md@demo.test')
    const rows = (await reports.runReport(md, 'attendance-summary', [EDX], { from: '1900-01-01', to: today() })).rows as { working_days: number }[]
    for (const r of rows) expect(r.working_days).toBeLessThanOrEqual(367)
    expect(Array.isArray((await reports.runReport(md, 'attendance-summary', [EDX], { from: "x' or 1=1", to: 'nope' })).rows)).toBe(true)
  })
})

describe('Phase 11 operations and access', () => {
  it('operations counts match independent queries for the signed-in role', async () => {
    const md = await ctxFor('md@demo.test')
    const { ops } = await teamAndOperations(md, [EDX])
    const [q] = await as('md@demo.test', (tx) => tx`select
      (select count(*)::int from student_tickets where org_id = ${EDX} and status in ('open', 'in_progress', 'waiting_for_student')) as tickets,
      (select count(*)::int from dvr_requests where org_id = ${EDX} and status not in ('draft', 'verification_completed', 'closed', 'cancelled')) as dvr`)
    expect(ops.open_tickets).toBe(q.tickets)
    expect(ops.verification_requests).toBe(q.dvr)
    const docs = (await reports.runReport(md, 'documents', [EDX], {})).rows.length
    expect(ops.pending_documents).toBe(docs)
  })

  it('role limits: reports are hidden without the permission, exports audited, other company excluded', async () => {
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    expect(await kindOf(reports.runReport(counsellor, 'attendance-summary', [EDX], {}))).toBe('not_found')
    expect(await kindOf(reports.exportReport(counsellor, 'employee-tasks', [EDX], {}))).toBe('not_found')
    const team = await teamAndOperations(counsellor, [EDX])
    expect(team.attendance).toEqual([])
    expect(team.tasks).toEqual([])

    const grd = await ctxFor('grd.manager@demo.test')
    const rows = await teamAndOperations(grd, [GRD])
    expect(rows.attendance.every((r) => r.company !== 'Dr.Expert Edulinks')).toBe(true)
    const names = (await adminSql()`select u.full_name from organization_memberships m join user_profiles u on u.id = m.user_id where m.org_id = ${EDX} and not exists (select 1 from organization_memberships g where g.user_id = m.user_id and g.org_id = ${GRD})`).map((x) => x.full_name)
    const seen = (await reports.runReport(grd, 'employee-tasks', [GRD], {}).catch(() => ({ rows: [] }))).rows.map((x) => x.staff)
    for (const n of seen) expect(names).not.toContain(n)

    const md = await ctxFor('md@demo.test')
    const exp = await reports.exportReport(md, 'attendance-summary', [EDX], {})
    expect(exp.csv).toContain('No record')
    expect(await adminSql()`select 1 from audit_logs where action = 'export' and entity_id = 'attendance-summary' and occurred_at > now() - interval '1 minute'`).not.toHaveLength(0)
  })
})
