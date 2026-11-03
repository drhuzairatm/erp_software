/** Phase B: education background, passport privacy, universities and automatic checklists. */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import { getChecklist } from '@/services/documents'
import { previewImport } from '@/services/student-import'
import * as students from '@/services/students'
import * as uni from '@/services/universities'
import { adminSql, as, ctxFor, expectDbError, orgId, delegateToSystemAdmin } from '../support/helpers'
beforeAll(async () => { await delegateToSystemAdmin(['universities.manage']) }) // the MD has delegated these to the System Administrator (test setup)

let EDX: string, GRD: string
const id = async (table: string, where: string) => (await adminSql().unsafe(`select id from ${table} where ${where} limit 1`))[0].id as string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}

async function newStudent(email = 'edx.manager@demo.test', extra: Record<string, unknown> = {}) {
  const ctx = await ctxFor(email)
  const r = await students.createStudent(ctx, { originatingOrgId: EDX, fullName: 'Phase B Student', phone: `+91 90030 ${rand()}`, ...extra })
  if (!r.ok) throw new Error('create failed')
  return { ctx, id: r.id }
}

describe('education background is separate from the destination', () => {
  it('stores previous-education country, school country and institution', async () => {
    const india = await id('countries', `code = 'IN'`), qatar = await id('countries', `code = 'QA'`), ru = await id('countries', `code = 'RU'`)
    const { ctx, id: sid } = await newStudent('edx.manager@demo.test', { previousEducationCountryId: qatar, schoolCountryId: qatar, institutionName: 'Example School Doha', destinationCountryId: ru })
    const p = await students.getStudent(ctx, sid)
    expect(p?.student).toMatchObject({ previous_education_country_name: 'Qatar', school_country_name: 'Qatar', institution_name: 'Example School Doha', country_name: 'Russia' })
    const list = await students.listStudents(ctx, [EDX], { educationCountry: qatar })
    expect(list.rows.map((r) => r.id)).toContain(sid)
    const indiaList = await students.listStudents(ctx, [EDX], { educationCountry: india })
    expect(indiaList.rows.map((r) => r.id)).not.toContain(sid)
  })
})

describe('passport details are protected', () => {
  it('visible to permitted roles, masked for others, never readable from the base table', async () => {
    const pass = `PB${rand()}`
    const { ctx, id: sid } = await newStudent('edx.manager@demo.test', { passportNumber: pass.toLowerCase(), passportExpiry: '2031-05-01' })
    expect((await students.getStudent(ctx, sid))?.student.passport_number).toBe(pass) // stored upper-case
    for (const email of ['edx.finance@demo.test', 'md@demo.test']) {
      const s = (await students.getStudent(await ctxFor(email), sid))?.student
      if (email === 'md@demo.test') expect(s?.passport_number).toBe(pass)
      else { expect(s?.passport_number).toBeNull(); expect(s?.passport_masked).toBe('•••••' + pass.slice(-3)); expect(s?.passport_visible).toBe(false) }
    }
    await expectDbError(as('edx.manager@demo.test', (tx) => tx`select passport_number from students limit 1`), '42501')
  })
  it('search by passport number works only with the permission', async () => {
    const pass = `PS${rand()}`
    const { id: sid } = await newStudent('edx.manager@demo.test', { passportNumber: pass })
    expect((await students.listStudents(await ctxFor('edx.manager@demo.test'), [EDX], { q: pass })).rows.map((r) => r.id)).toContain(sid)
    expect((await students.listStudents(await ctxFor('edx.finance@demo.test'), [EDX], { q: pass })).rows.map((r) => r.id)).not.toContain(sid)
  })
  it('a role without the permission cannot record passport details', async () => {
    // fictional role: can register students but has no passport permission
    const [role] = await adminSql()`insert into roles (org_id, key, name) values (${EDX}, 'intake_clerk', 'Intake clerk') returning id`
    await adminSql()`insert into role_permissions (role_id, permission_key) select ${role.id}, unnest(array['students.create', 'students.read.all', 'students.update', 'students.contact.view'])`
    const [u] = await adminSql()`insert into user_profiles (email, full_name) values ('intake.clerk@example.test', 'Intake Clerk (fictional)') returning id`
    await adminSql()`insert into organization_memberships (user_id, org_id, role_id) values (${u.id}, ${EDX}, ${role.id})`
    const clerk = await ctxFor('intake.clerk@example.test')
    await expectServiceError(students.createStudent(clerk, { originatingOrgId: EDX, fullName: 'No Passport Allowed', phone: `+91 90031 ${rand()}`, passportNumber: 'AB12345' }), 'forbidden')
    // editing a student does not erase a passport the clerk cannot see
    const pass = `PK${rand()}`
    const { id: sid } = await newStudent('edx.manager@demo.test', { passportNumber: pass })
    await students.updateStudent(clerk, sid, { originatingOrgId: EDX, fullName: 'Renamed By Clerk', phone: `+91 90032 ${rand()}` })
    const [row] = await adminSql()`select full_name, passport_number from students where id = ${sid}`
    expect(row).toMatchObject({ full_name: 'Renamed By Clerk', passport_number: pass })
    await expect(previewImport(clerk, EDX, 'Name,Phone,Passport\nX Y,+91 90033 11111,AB12345\n')).rejects.toBeInstanceOf(ServiceError)
  })
  it('the audit log records that contact/passport fields changed, never their values', async () => {
    const pass = `PA${rand()}`
    const { ctx, id: sid } = await newStudent('edx.manager@demo.test', { passportNumber: pass })
    const newPhone = `+91 90034 ${rand()}`
    // (a different passport number must be recorded as a verified renewal, so the student form changes the expiry here)
    await students.updateStudent(ctx, sid, { originatingOrgId: EDX, fullName: 'Phase B Student', phone: newPhone, passportNumber: pass, passportExpiry: '2035-03-03' })
    const rows = await adminSql()`select before_data::text as b, after_data::text as a from audit_logs where entity_type = 'students' and entity_id = ${sid}`
    const all = rows.map((r) => `${r.b} ${r.a}`).join(' ')
    expect(all).not.toContain(pass)
    expect(all).not.toContain(newPhone.replace(/\D/g, '').slice(-5))
    expect(all).toContain('(changed)')
  })
  it('duplicate detection matches passport numbers across brands without revealing the record', async () => {
    const pass = `PD${rand()}`
    await newStudent('edx.manager@demo.test', { passportNumber: pass })
    const grd = await ctxFor('grd.manager@demo.test')
    const r = await students.createStudent(grd, { originatingOrgId: GRD, fullName: 'Same Passport', phone: `+91 90035 ${rand()}`, passportNumber: pass })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.duplicates[0]).toMatchObject({ matched_on: 'passport', visible: false, student_code: null })
  })
})

describe('universities and automatic document checklists', () => {
  it('assigning a university adds its required documents (course-specific only when the course matches)', async () => {
    const admin = await ctxFor('admin@demo.test') // system admin: universities.manage
    const ge = await id('countries', `code = 'GE'`), mbbs = await id('courses', `code = 'MBBS'`), nursing = await id('courses', `code = 'NURSING'`)
    const uid = await uni.saveUniversity(admin, null, { countryId: ge, name: `Test Medical University ${rand()}` })
    await uni.addUniversityPart(admin, uid, 'requirement', { documentTypeId: await id('document_types', `key = 'medical_certificate'`) })
    await uni.addUniversityPart(admin, uid, 'requirement', { documentTypeId: await id('document_types', `key = 'language_certificate'`), courseId: nursing })
    await uni.addUniversityPart(admin, uid, 'campus', { name: 'North campus' })
    const { ctx, id: sid } = await newStudent('edx.manager@demo.test', { destinationCountryId: ge, courseId: mbbs })
    const before = (await getChecklist(ctx, sid)).items.map((i) => i.type_key)
    expect(before).not.toContain('medical_certificate')
    await students.updateStudent(ctx, sid, { originatingOrgId: EDX, fullName: 'Phase B Student', phone: `+91 90036 ${rand()}`, destinationCountryId: ge, courseId: mbbs, preferredUniversityId: uid })
    const items = (await getChecklist(ctx, sid)).items
    expect(items.find((i) => i.type_key === 'medical_certificate')?.requirement_source).toBe('university')
    expect(items.map((i) => i.type_key)).not.toContain('language_certificate') // Nursing-only rule
    const tl = await students.getTimeline(ctx, sid)
    expect(tl.some((e) => /document requirement\(s\) added for Test Medical University/.test(e.summary))).toBe(true)

    // a rule added later reaches students already assigned; removing it keeps their checklist item
    await uni.addUniversityPart(admin, uid, 'requirement', { documentTypeId: await id('document_types', `key = 'bank_statement'`) })
    expect((await getChecklist(ctx, sid)).items.map((i) => i.type_key)).toContain('bank_statement')
    const rq = (await uni.getUniversity(admin, uid))!.requirements.find((r) => r.document.startsWith('Bank'))!
    await uni.removeRequirement(admin, rq.id)
    expect((await getChecklist(ctx, sid)).items.map((i) => i.type_key)).toContain('bank_statement')
  })

  it('a campus must belong to the chosen university', async () => {
    const otherCampus = await id('university_campuses', 'true')
    const ru = await id('countries', `code = 'RU'`)
    const ruUni = await id('universities', `country_id = '${ru}' and id not in (select university_id from university_campuses where id = '${otherCampus}')`)
    await expectServiceError(newStudent('edx.manager@demo.test', { destinationCountryId: ru, preferredUniversityId: ruUni, preferredCampusId: otherCampus }), 'invalid')
  })

  it('only holders of "manage universities" can configure them (also at database level)', async () => {
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    const uid = await id('universities', 'true')
    await expectServiceError(uni.addUniversityPart(counsellor, uid, 'campus', { name: 'Sneaky campus' }), 'forbidden')
    await expectDbError(as('edx.counsellor@demo.test', (tx) => tx`insert into university_campuses (id, university_id, name) values (${randomUUID()}, ${uid}, 'Direct insert')`), '42501')
    // but everyone can read university information
    expect((await uni.listUniversities(counsellor, {})).length).toBeGreaterThan(0)
    const ceo = await ctxFor('ceo@demo.test')
    expect((await uni.getUniversity(ceo, uid))?.university.id).toBe(uid)
  })
})
