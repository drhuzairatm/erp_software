/** Phase 3: academic records, eligibility thresholds, name checks, One and Same workflow, business configuration. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/server/db'
import { ServiceError } from '@/server/errors'
import * as ac from '@/server/services/academic'
import * as documents from '@/server/services/documents'
import * as pp from '@/server/services/passport'
import * as students from '@/server/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId, delegateToSystemAdmin } from '../support/helpers'
beforeAll(async () => { await delegateToSystemAdmin(['academic.rules.manage']) }) // the MD has delegated these to the System Administrator (test setup)

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const course = async (code: string) => (await adminSql()`select id from courses where code = ${code}`)[0].id as string
beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}
async function newStudent(extra: Record<string, unknown> = {}) {
  const ctx = await ctxFor('edx.manager@demo.test')
  const r = await students.createStudent(ctx, { originatingOrgId: EDX, fullName: 'Anjali Suresh Varma', phone: `+91 90098 ${rand()}`, phone2: `+91 90099 ${rand()}`,
    email: `p3.${rand()}@example.test`, passportNumber: `PT${rand()}`, passportExpiry: '2032-01-01', ...extra })
  if (!r.ok) throw new Error('duplicate')
  return { ctx, id: r.id }
}
const plusTwo = (marks: Record<string, number>, extra: Record<string, string> = {}) => [
  { kind: 'plus_two', nameOnCertificate: 'ANJALI SURESH VARMA', gradingSystem: 'marks', totalMarks: '400', marksObtained: String(Object.values(marks).reduce((a, b) => a + b, 0)), yearOfPassing: '2025', ...extra },
  Object.entries(marks).map(([key, m]) => ({ key, name: key[0].toUpperCase() + key.slice(1), max: '100', obtained: String(m) })),
] as const

describe('business configuration supplied by the MD', () => {
  it('is installed: 12-month passport rule (block), Bulgaria 60% thresholds, Varna/Pleven, Bonafide wording approved by the MD; One and Same wording approved', async () => {
    const sql = adminSql()
    const [p] = await sql`select min_months, enforcement, stage_key, is_active from passport_validity_rules where name like 'Passport valid for at least 12 months%'`
    expect(p).toEqual({ min_months: 12, enforcement: 'block', stage_key: 'university_application', is_active: true })
    const t = await sql`select i.subject_key, i.min_percentage::int as m from advisory_notices n join advisory_notice_items i on i.notice_id = n.id
                          join countries c on c.id = n.destination_country_id where c.code = 'BG' and n.status = 'active' order by 1`
    expect(t).toEqual(['biology', 'chemistry', 'english', 'physics'].map((s) => ({ subject_key: s, m: 60 })))
    expect((await sql`select count(*)::int as n from academic_thresholds where is_active`)[0].n).toBe(0) // replaced by advisory notices
    expect((await sql`select name from universities where name like 'Medical University – %' order by 1`).map((r) => r.name)).toEqual(['Medical University – Pleven', 'Medical University – Varna'])
    const [b] = await sql`select r.status, c.code as edu, d.code as dest, u.name as uni, (select array_agg(q.kind order by q.sort_order) from verification_requirements q where q.rule_id = r.id) as kinds,
                                 (select q.text from verification_requirements q where q.rule_id = r.id and q.kind = 'statement') as statement
                            from verification_rules r join countries c on c.id = r.previous_education_country_id join countries d on d.id = r.destination_country_id
                            join universities u on u.id = r.university_id where r.name like 'Bonafide – Indian student at a Qatar school%'`
    expect(b).toMatchObject({ status: 'approved', edu: 'QA', dest: 'BG', uni: 'Medical University – Varna', kinds: ['statement', 'keywords'] })
    expect(b.statement).toMatch(/eligible to apply and continue her\/his studies at various institutions and universities in India, Qatar as well as abroad/)
    const [oas] = await adminSql()`select status, body from one_and_same_templates where name = 'One and Same declaration'`
    expect(oas.status).toBe('approved')
    expect(oas.body).toMatch(/refer to one and the same person/)
  })

  it('a passport valid for less than 12 months blocks University Application', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const short = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10)
    const { id } = await newStudent({ passportExpiry: short })
    await students.changeStage(mgr, id, { toStage: 'registration' })
    const e = await expectServiceError(students.changeStage(mgr, id, { toStage: 'university_application', acknowledge: 'yes' }), 'invalid')
    expect(e.message).toMatch(/at least 12 months/)
  })
})

describe('academic records', () => {
  it('records Plus Two with subjects; percentage comes from marks, never from CGPA', async () => {
    const { ctx, id } = await newStudent()
    const [v, subs] = plusTwo({ physics: 70, chemistry: 80, biology: 90, english: 60 })
    await ac.saveRecord(ctx, id, null, { ...v }, [...subs])
    await ac.saveRecord(ctx, id, null, { kind: 'class_10', gradingSystem: 'cgpa_10', cgpa: '9.2', nameOnCertificate: 'ANJALI SURESH VARMA' }, [])
    const a = (await ac.getAcademic(ctx, id))!
    const p2 = a.records.find((r) => r.kind === 'plus_two')!
    expect(Number(p2.pct)).toBe(75)
    expect(a.subjects.filter((x) => x.record_id === p2.id).map((x) => Number(x.pct))).toEqual([70, 80, 90, 60])
    expect(a.records.find((r) => r.kind === 'class_10')!.pct).toBeNull()
    await expectServiceError(ac.saveRecord(ctx, id, null, { kind: 'plus_two', totalMarks: '100', marksObtained: '120' }, []), 'invalid')
    // a role that cannot edit the student cannot add records; another company cannot see them
    await expectServiceError(ac.saveRecord(await ctxFor('ceo@demo.test'), id, null, { kind: 'other', title: 'X' }, []))
    expect(await ac.getAcademic(await ctxFor('grd.manager@demo.test'), id)).toBeNull()
    await expectDbError(as('grd.manager@demo.test', (tx) => tx`insert into academic_records (student_id, kind) values (${id}, 'other')`), '42501')
  })

  it('postgraduate medical courses use the MBBS profile', async () => {
    const { ctx, id } = await newStudent({ courseId: await course('PG_MEDICAL') })
    expect((await ac.getAcademic(ctx, id))!.profile).toBe('pg_medical')
    await ac.saveRecord(ctx, id, null, { kind: 'internship', nameOnCertificate: 'DR ANJALI SURESH VARMA', startDate: '2024-01-01', endDate: '2024-12-31' }, [])
    await ac.saveRecord(ctx, id, null, { kind: 'medical_registration', registrationAuthority: 'State Medical Council (demo)', registrationNumber: 'REG-1' }, [])
    expect((await ac.getAcademic(ctx, id))!.records.map((r) => r.kind)).toEqual(['internship', 'medical_registration'])
  })
})

describe('academic reminders at stages (never blocking)', () => {
  it('a missing Plus Two is a warning at University Application; the stage check cannot be set to block', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const admin = await ctxFor('admin@demo.test')
    const { id } = await newStudent()
    await students.changeStage(mgr, id, { toStage: 'registration' })
    const w = await students.changeStage(mgr, id, { toStage: 'university_application' })
    expect(w.ok).toBe(false)
    if (!w.ok) expect(w.warnings.join(' ')).toMatch(/Plus Two .* not recorded/)
    await expectServiceError(ac.setAcademicCheck(admin, 'university_application', 'block'), 'invalid')
    expect(await students.changeStage(mgr, id, { toStage: 'university_application', acknowledge: 'yes' })).toEqual({ ok: true })
  })
})

describe('name checks', () => {
  it('detects differences between the passport and certificates as warnings for review', async () => {
    const [r] = await adminSql()`select app.compare_names('ANJALI SURESH VARMA', 'ANJALI S VARMA') a, app.compare_names('RAHUL NAIR', 'NAIR RAHUL') b,
      app.compare_names('PRIYA MENON', 'PRIYA') c, app.compare_names('MOHAMMED ASHRAF', 'MUHAMMED ASHRAF') d, app.compare_names('ARJUN DEV KRISHNA', 'ARJUN KRISHNA') e,
      app.compare_names('Rahul  Nair.', 'RAHUL NAIR') f, app.compare_names('MOHAMMED ALI', 'MOHAMMEDALI') g, app.compare_names('JOHN SMITH', 'MARY JONES') h`
    expect(r).toEqual({ a: ['initials'], b: ['name_order'], c: ['missing_surname'], d: ['spelling'], e: ['missing_middle_name'], f: [], g: ['spacing'], h: ['other'] })
  })

  it('a difference needs the passport holder name; review: no document needed (with note) or require One and Same', async () => {
    const { ctx, id } = await newStudent()
    const [v, subs] = plusTwo({ physics: 70, chemistry: 70, biology: 70, english: 70 }, { nameOnCertificate: 'ANJALI S VARMA' })
    await ac.saveRecord(ctx, id, null, { ...v }, [...subs])
    expect((await ac.getAcademic(ctx, id))!.checks).toHaveLength(0) // no holder name yet
    const [cur] = await adminSql()`select passport_number, expiry_date::text from student_passports where student_id = ${id} and is_current`
    await pp.recordPassport(ctx, id, { kind: 'correction', passportNumber: cur.passport_number, holderName: 'ANJALI SURESH VARMA', expiryDate: cur.expiry_date, notes: 'Holder name added' })
    const [c] = (await ac.getAcademic(ctx, id))!.checks
    expect(c).toMatchObject({ mismatch_types: ['initials'], review_status: 'open' })
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    await expectServiceError(ac.reviewNameCheck(counsellor, c.id, 'no_action', 'same'), 'forbidden') // needs documents.review
    await expectServiceError(ac.reviewNameCheck(ctx, c.id, 'no_action', ''), 'invalid')
    await ac.reviewNameCheck(ctx, c.id, 'no_action', 'Initial is accepted by the university (test)')
    const after = (await ac.getAcademic(ctx, id))!.checks[0]
    expect(after).toMatchObject({ review_status: 'no_action', case_id: null })
    // correcting the certificate name to match clears the finding
    await ac.saveRecord(ctx, id, (await ac.getAcademic(ctx, id))!.records[0].id, { ...v, nameOnCertificate: 'Anjali Suresh Varma' }, [...subs])
    expect((await ac.getAcademic(ctx, id))!.checks).toHaveLength(0)
  })
})

describe('One and Same workflow', () => {
  it('mandatory rule → checklist item + staff and manager tasks; approved template → preview → request; tracked via document review', async () => {
    const admin = await ctxFor('admin@demo.test')
    const mgr = await ctxFor('edx.manager@demo.test')
    await ac.addOasRule(admin, { name: `Test mandatory surname ${rand()}`, mismatchType: 'missing_surname', requirement: 'mandatory' })
    await expectServiceError(ac.addOasRule(mgr, { name: 'No', requirement: 'mandatory' }), 'forbidden')
    // template: drafted by the administrator, approved by a manager; approved templates are frozen
    await ac.addTemplate(admin, { name: `Test template ${rand()}`, body: 'I, {{student_name}}, declare that {{passport_name}} and {{certificate_name}} ({{document}}) are one and the same person.' })
    const tpl = (await ac.academicConfig(admin)).templates.find((t) => t.name.startsWith('Test template') && t.status === 'draft')!
    await expectServiceError(ac.approveTemplate(admin, tpl.id), 'forbidden')
    await ac.approveTemplate(mgr, tpl.id)
    await expectDbError(adminSql()`update one_and_same_templates set body = 'changed wording to something else' where id = ${tpl.id}`, '42501')

    const { ctx, id } = await newStudent({ fullName: 'Tejas Placeholder Test' })
    const [cur] = await adminSql()`select passport_number, expiry_date::text from student_passports where student_id = ${id} and is_current`
    await pp.recordPassport(ctx, id, { kind: 'correction', passportNumber: cur.passport_number, holderName: 'TEJAS PLACEHOLDER', expiryDate: cur.expiry_date, notes: 'Holder name' })
    const [v, subs] = plusTwo({ physics: 70, chemistry: 70, biology: 70, english: 70 }, { nameOnCertificate: 'TEJAS' })
    await ac.saveRecord(ctx, id, null, { ...v }, [...subs])
    const c = (await ac.getAcademic(ctx, id))!.checks[0]
    expect(c).toMatchObject({ mismatch_types: ['missing_surname'], requirement: 'mandatory', case_status: 'mandatory' })
    const tasks = await adminSql()`select title, assigned_to is not null as assigned from tasks where student_id = ${id} and source_key like 'oas:%' order by source_key`
    expect(tasks.map((t) => t.title)).toEqual([expect.stringContaining('For information: One and Same required'), expect.stringContaining('One and Same required')])
    const item = (await documents.getChecklist(ctx, id)).items.find((i) => i.type_key === 'one_and_same')!
    expect(item).toMatchObject({ is_required: true, status: 'missing' })
    // a mandatory case cannot be dismissed by staff
    await expectServiceError(ac.reviewNameCheck(ctx, c.id, 'no_action', 'x'))

    await expectServiceError(ac.requestOneAndSame(ctx, c.case_id!, 'manual', 'Called'), 'invalid') // preview first
    await ac.prepareOneAndSame(ctx, c.case_id!, tpl.id)
    const prepared = (await ac.getAcademic(ctx, id))!.checks[0]
    expect(prepared.preview_text).toBe('I, Tejas Placeholder Test, declare that TEJAS PLACEHOLDER and TEJAS (Plus Two) are one and the same person.')
    await expectServiceError(ac.requestOneAndSame(ctx, c.case_id!, 'manual', ''), 'invalid')
    await ac.requestOneAndSame(ctx, c.case_id!, 'manual', 'Phoned the student (test)')
    expect((await ac.getAcademic(ctx, id))!.checks[0].case_status).toBe('pending')

    // the student's document goes through the normal review: received → verified → approved
    const docs = await ctxFor('docs@demo.test')
    await students.setAssignment(mgr, id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
    await documents.uploadDocument(docs, item.id, new File([Buffer.from('%PDF-1.4\n% fictional\n')], 'oas.pdf', { type: 'application/pdf' }))
    expect((await ac.getAcademic(ctx, id))!.checks[0].case_status).toBe('received')
    for (const q of (await documents.getDocumentReview(docs, item.id))!.requirements.filter((x) => x.is_mandatory)) await documents.recordVerification(docs, item.id, q.id, 'present')
    await documents.documentAction(docs, item.id, 'verify')
    expect((await ac.getAcademic(ctx, id))!.checks[0].case_status).toBe('verified')
    await documents.documentAction(docs, item.id, 'submit')
    await documents.documentAction(mgr, item.id, 'approve')
    expect((await ac.getAcademic(ctx, id))!.checks[0].case_status).toBe('approved')
    await adminSql()`update one_and_same_rules set is_active = false where name like 'Test mandatory surname%'`
  })

  it('a manager can cancel a requirement with a reason; requesting by message needs an enabled message rule', async () => {
    const { ctx, id } = await newStudent()
    const [cur] = await adminSql()`select passport_number, expiry_date::text from student_passports where student_id = ${id} and is_current`
    await pp.recordPassport(ctx, id, { kind: 'correction', passportNumber: cur.passport_number, holderName: 'ANJALI SURESH VARMA', expiryDate: cur.expiry_date, notes: 'Holder name' })
    const [v, subs] = plusTwo({ physics: 70, chemistry: 70, biology: 70, english: 70 }, { nameOnCertificate: 'VARMA ANJALI SURESH' })
    await ac.saveRecord(ctx, id, null, { ...v }, [...subs])
    const c = (await ac.getAcademic(ctx, id))!.checks[0]
    const caseId = await ac.reviewNameCheck(ctx, c.id, 'one_and_same', 'University wants it (test)')
    const opened = (await ac.getAcademic(ctx, id))!.checks[0]
    expect(opened.case_status).toMatch(/recommended|mandatory/)
    const tpl = (await adminSql()`select id from one_and_same_templates where status = 'approved' limit 1`)[0]
    await ac.prepareOneAndSame(ctx, opened.case_id!, tpl.id)
    await adminSql()`update notification_rules set is_enabled = false where event_key = 'one_and_same_requested'`
    await expectServiceError(ac.requestOneAndSame(ctx, opened.case_id!, 'message'), 'invalid')
    await expectServiceError(ac.cancelOneAndSame(await ctxFor('docs@demo.test'), opened.case_id!, 'x'))
    await expectServiceError(ac.cancelOneAndSame(ctx, opened.case_id!, ''), 'invalid')
    await ac.cancelOneAndSame(ctx, opened.case_id!, 'University confirmed the name order is acceptable (test)')
    expect((await ac.getAcademic(ctx, id))!.checks[0].case_status).toBe('cancelled')
    expect(caseId).toBeTruthy()
  })
})
