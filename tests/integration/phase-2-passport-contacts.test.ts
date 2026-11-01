/** Phase 2: passport versions & expiry monitoring, international phones, contact history, email verification. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/server/db'
import { ServiceError } from '@/server/errors'
import * as pp from '@/server/services/passport'
import * as students from '@/server/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const country = async (code: string) => (await adminSql()`select id from countries where code = ${code}`)[0].id as string
const inMonths = (m: number) => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10) }
beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}
async function newStudent(extra: Record<string, unknown> = {}) {
  const ctx = await ctxFor('edx.manager@demo.test')
  const r = await students.createStudent(ctx, { originatingOrgId: EDX, fullName: 'Phase Two Student', phone: `+91 90097 ${rand()}`, email: `p2.${rand()}@example.test`, ...extra })
    .catch((e: ServiceError) => { throw new Error(`${e.message} ${JSON.stringify(e.fieldErrors)}`) })
  if (!r.ok) throw new Error('duplicate')
  return { ctx, id: r.id }
}

describe('international phone numbers', () => {
  it('stores three numbers in E.164, each with its own country', async () => {
    const { ctx, id } = await newStudent({ phone: '98765 ' + rand(), phoneCountry: 'IN', phone2: '050 123 ' + rand().slice(0, 4), phone2Country: 'AE',
      phone3: '+44 7911 123456', phone3Country: 'GB', phone3Label: 'Uncle in UK' })
    const s = (await students.getStudent(ctx, id))!.student
    expect(s.phone).toMatch(/^\+919876\d{6}$/)
    expect(s).toMatchObject({ phone_country: 'IN', phone2_country: 'AE', phone3_country: 'GB', phone3_label: 'Uncle in UK' })
    expect(s.phone2).toMatch(/^\+97150123\d{4}$/)
  })

  it('rejects invalid numbers and a calling code that does not match the chosen country (never switches it silently)', async () => {
    const ctx = await ctxFor('edx.manager@demo.test')
    const e1 = await expectServiceError(students.createStudent(ctx, { originatingOrgId: EDX, fullName: 'Bad Phone', phone: '5555555', phoneCountry: 'IN' }), 'invalid')
    expect(e1.fieldErrors?.phone?.[0]).toMatch(/India/)
    const e2 = await expectServiceError(students.createStudent(ctx, { originatingOrgId: EDX, fullName: 'Bad Phone', phone: '+91 98765 ' + rand(), phone2: '+91 98765 ' + rand(), phone2Country: 'AE' }), 'invalid')
    expect(e2.fieldErrors?.phone2?.[0]).toMatch(/\+91 but United Arab Emirates/)
  })

  it('records contact changes (old, new, country, author, verification status); hidden without contact permission', async () => {
    const { ctx, id } = await newStudent()
    const before = (await students.getStudent(ctx, id))!.student
    const newPhone2 = '+971 50 123 ' + rand().slice(0, 4)
    await students.updateStudent(ctx, id, { originatingOrgId: EDX, fullName: 'Phase Two Student', phone: before.phone, email: before.email, phone2: newPhone2, phone2Country: 'AE' })
    const h = await pp.getContactHistory(ctx, id)
    const row = h.find((x) => x.field === 'phone2')!
    expect(row).toMatchObject({ old_value: null, country_code: 'AE', verification_status: 'not_verified', author: expect.stringContaining('Rahul') })
    expect(row.new_value).toMatch(/^\+97150123/)
    expect(await pp.getContactHistory(await ctxFor('grd.manager@demo.test'), id)).toHaveLength(0)
    await expectDbError(adminSql()`update student_contact_changes set new_value = 'x' where student_id = ${id}`, 'P0001') // append-only
  })
})

describe('stage requirements', () => {
  it('secondary phone and email are required from University Application (draft profiles may be incomplete)', async () => {
    const { id } = await newStudent()
    const mgr = await ctxFor('edx.manager@demo.test')
    expect(await students.changeStage(mgr, id, { toStage: 'registration' })).toEqual({ ok: true })
    const e = await expectServiceError(students.changeStage(mgr, id, { toStage: 'university_application', acknowledge: 'yes' }), 'invalid')
    expect(e.message).toMatch(/secondary phone/)
    // the database refuses it as well
    await expectDbError(as('edx.manager@demo.test', (tx) => tx`select app.change_student_stage(${id}, 'university_application', 'direct', null, null, '[]'::jsonb)`), '23514')
  })

  it('minimum passport validity rules: configurable warn or block, by destination and stage', async () => {
    const admin = await ctxFor('admin@demo.test')
    const bg = await country('BG')
    await pp.addValidityRule(admin, { name: `Test BG visa ${rand()}`, destinationCountryId: bg, stageKey: 'visa_processing', minMonths: '18', enforcement: 'block' })
    await pp.addValidityRule(admin, { name: `Test BG admission ${rand()}`, destinationCountryId: bg, stageKey: 'admission_letter', minMonths: '16', enforcement: 'warn' })
    await expectServiceError(pp.addValidityRule(await ctxFor('edx.manager@demo.test'), { name: 'Nope', stageKey: 'visa_processing', minMonths: '6', enforcement: 'warn' }), 'forbidden')
    const { id } = await newStudent({ destinationCountryId: bg, phone2: '+91 98760 ' + rand(), passportNumber: `PV${rand()}`, passportExpiry: inMonths(15) })
    const mgr = await ctxFor('edx.manager@demo.test')
    const w = await students.changeStage(mgr, id, { toStage: 'admission_letter' })
    expect(w.ok).toBe(false)
    if (!w.ok) expect(w.warnings.join(' ')).toMatch(/at least 16 months/)
    await students.changeStage(mgr, id, { toStage: 'admission_letter', acknowledge: 'yes' })
    const e = await expectServiceError(students.changeStage(mgr, id, { toStage: 'visa_processing', acknowledge: 'yes' }), 'invalid')
    expect(e.message).toMatch(/at least 18 months/)
    await adminSql()`update passport_validity_rules set is_active = false where name like 'Test BG%'`
  })
})

describe('passport records', () => {
  it('every change becomes a new version; nothing is overwritten or deleted', async () => {
    const num = `PA${rand()}`
    const { ctx, id } = await newStudent({ passportNumber: num, passportExpiry: '2031-01-01' })
    const cur = (await students.getStudent(ctx, id))!.student
    await students.updateStudent(ctx, id, { originatingOrgId: EDX, fullName: 'Phase Two Student', phone: cur.phone, email: cur.email, passportNumber: num, passportExpiry: '2031-06-01' })
    const d = (await pp.getPassportData(ctx, id))!
    expect(d.versions.map((v) => [v.version, v.kind, v.is_current, v.expiry_date])).toEqual([[2, 'edit', true, '2031-06-01'], [1, 'initial', false, '2031-01-01']])
    await expectDbError(adminSql()`update student_passports set expiry_date = '2040-01-01' where student_id = ${id}`, '42501')
    await expectDbError(adminSql()`delete from student_passports where student_id = ${id}`, '42501')
  })

  it('renewal: needs a new number, keeps the old passport, records receipt and closes passport tasks', async () => {
    const num = `PB${rand()}`
    const { ctx, id } = await newStudent({ passportNumber: num, passportExpiry: inMonths(2) })
    const open = await adminSql()`select title, status, assigned_to from tasks where student_id = ${id} and task_type = 'passport'`
    expect(open.map((t) => t.title).join(' ')).toMatch(/CRITICAL/)
    expect(open.some((t) => t.title.startsWith('Escalation'))).toBe(true)
    await expectServiceError(pp.recordPassport(ctx, id, { kind: 'renewal', passportNumber: num, expiryDate: '2036-01-01' }), 'invalid')
    await pp.recordPassport(ctx, id, { kind: 'renewal', passportNumber: `PN${rand()}`, holderName: 'PHASE TWO STUDENT', gender: 'female',
      nationalityCountryId: await country('IN'), citizenshipCountryId: await country('IN'), issuingCountryId: await country('IN'),
      issueDate: '2026-01-01', expiryDate: '2036-01-01', placeOfIssue: 'Kochi' })
    // awaiting verification: the old passport stays active
    let d = (await pp.getPassportData(ctx, id))!
    expect(d.current).toMatchObject({ version: 1, passport_number: num })
    expect(d.pending).toMatchObject({ version: 2, kind: 'renewal', verification_status: 'pending', is_current: false })
    expect(d.followups[0]).toMatchObject({ kind: 'received' })
    expect((await students.getStudent(ctx, id))!.student.passport_status).toBe('critical')
    await pp.verifyPassport(ctx, d.pending!.id, 'verified', 'Checked against the scan')
    d = (await pp.getPassportData(ctx, id))!
    expect(d.pending).toBeNull()
    expect(d.current).toMatchObject({ version: 2, kind: 'renewal', holder_name: 'PHASE TWO STUDENT', tier: 'valid', verification_status: 'verified' })
    expect(d.versions[1]).toMatchObject({ passport_number: num, is_current: false })
    const tasks = await adminSql()`select status from tasks where student_id = ${id} and task_type = 'passport'`
    expect(tasks.every((t) => t.status === 'completed')).toBe(true)
    expect((await students.getStudent(ctx, id))!.student.passport_status).toBe('valid')
  })

  it('a new passport becomes active only after verification; rejection keeps the old passport', async () => {
    const num = `PV${rand()}`
    const { ctx, id } = await newStudent({ passportNumber: num, passportExpiry: inMonths(8) })
    // the student form cannot swap the passport number
    const cur = (await students.getStudent(ctx, id))!.student
    await expect(students.updateStudent(ctx, id, { originatingOrgId: EDX, fullName: 'Phase Two Student', phone: cur.phone, email: cur.email,
      passportNumber: `PX${rand()}`, passportExpiry: '2036-01-01' })).rejects.toThrow(/renewal/)
    const newNum = `PW${rand()}`
    await pp.recordPassport(ctx, id, { kind: 'renewal', passportNumber: newNum, expiryDate: '2036-01-01' })
    // only one new passport can wait at a time
    await expectServiceError(pp.recordPassport(ctx, id, { kind: 'renewal', passportNumber: `PY${rand()}`, expiryDate: '2036-02-01' }))
    const [task] = await adminSql()`select title, status, assigned_to from tasks where student_id = ${id} and source_key like 'passport-verify:%'`
    expect(task).toMatchObject({ status: 'not_started' })
    expect(task.title).toMatch(/Verify new passport/)
    // a counsellor can record but cannot verify
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    const pend = (await pp.getPassportData(ctx, id))!.pending!
    await expectServiceError(pp.verifyPassport(counsellor, pend.id, 'verified'))
    await expectServiceError(pp.verifyPassport(ctx, pend.id, 'rejected', ''), 'invalid')
    await pp.verifyPassport(ctx, pend.id, 'rejected', 'Number does not match the scan')
    const d = (await pp.getPassportData(ctx, id))!
    expect(d.current).toMatchObject({ passport_number: num, version: 1 })
    expect(d.pending).toBeNull()
    expect(d.versions.find((v) => v.id === pend.id)).toMatchObject({ verification_status: 'rejected', verification_note: 'Number does not match the scan' })
    expect((await students.getStudent(ctx, id))!.student.passport_status).toBe('warning')
    const [t2] = await adminSql()`select status from tasks where source_key = ${'passport-verify:' + pend.id}`
    expect(t2.status).toBe('cancelled')
    await expectServiceError(pp.verifyPassport(ctx, pend.id, 'verified'))
    // tampering is still impossible
    await expectDbError(adminSql()`update student_passports set verification_status = 'verified' where id = ${pend.id}`, '42501')
  })

  it('expiry tiers and deduplicated monitoring', async () => {
    const [t] = await adminSql()`select app.passport_tier(${inMonths(13)}) a, app.passport_tier(${inMonths(11)}) b, app.passport_tier(${inMonths(5)}) c,
                                        app.passport_tier(${inMonths(2)}) d, app.passport_tier('2020-01-01') e, app.passport_tier(null) f`
    expect(t).toEqual({ a: 'valid', b: 'warning', c: 'urgent', d: 'critical', e: 'expired', f: null })
    const { id } = await newStudent({ passportNumber: `PC${rand()}`, passportExpiry: inMonths(11) })
    await adminSql()`select app.passport_monitor()`
    await adminSql()`select app.passport_monitor(${id})`
    const tasks = await adminSql()`select source_key from tasks where student_id = ${id} and task_type = 'passport'`
    expect(tasks).toHaveLength(1) // warning: staff task only, no escalation, no duplicates
  })

  it('passport details need the passport permission; follow-ups are recorded', async () => {
    const { ctx, id } = await newStudent({ passportNumber: `PD${rand()}`, passportExpiry: inMonths(4) })
    const clerkless = await ctxFor('ceo@demo.test')
    expect(await pp.getPassportData(clerkless, id)).toBeNull()
    await expectServiceError(pp.recordPassport(clerkless, id, { kind: 'correction', passportNumber: 'ZZ12345', expiryDate: '2035-01-01', notes: 'x' }))
    await expectServiceError(pp.addPassportFollowup(ctx, id, { kind: 'commitment', note: 'Will renew' }), 'invalid')
    await pp.addPassportFollowup(ctx, id, { kind: 'commitment', note: 'Student will apply for renewal next week', expectedDate: inMonths(1) })
    expect((await pp.getPassportData(ctx, id))!.followups[0]).toMatchObject({ kind: 'commitment' })
    // passport status (not the passport itself) is visible to staff without passport permission
    const rows = await as('ceo@demo.test', (tx) => tx`select passport_status, passport_number from v_students where id = ${id}`)
    expect(rows[0]).toMatchObject({ passport_status: 'urgent', passport_number: null })
  })
})

describe('email verification', () => {
  const tokenFor = async (id: string) => {
    const [m] = await adminSql()`select params ->> 'link' as link from notification_messages where student_id = ${id} and event_key = 'email_verification' order by created_at desc limit 1`
    return new URL(m.link).searchParams.get('token')!
  }

  it('entered → pending → verified, only by opening the link; a changed address goes back to entered', async () => {
    const { ctx, id } = await newStudent()
    expect((await students.getStudent(ctx, id))!.student.email_status).toBe('entered')
    await pp.sendEmailVerification(ctx, id)
    expect((await students.getStudent(ctx, id))!.student.email_status).toBe('pending')
    const token = await tokenFor(id)
    expect(await pp.confirmEmailVerification('wrong-token-wrong-token-wrong')).toBe('invalid')
    expect(await pp.confirmEmailVerification(token)).toBe('verified')
    expect(await pp.confirmEmailVerification(token)).toBe('invalid') // single use
    const s = (await students.getStudent(ctx, id))!.student
    expect(s.email_status).toBe('verified')
    await students.updateStudent(ctx, id, { originatingOrgId: EDX, fullName: 'Phase Two Student', phone: s.phone, email: `changed.${rand()}@example.test` })
    expect((await students.getStudent(ctx, id))!.student.email_status).toBe('entered')
  })

  it('status cannot be set directly; expired links mark the email expired; links are hidden from staff without outbox access', async () => {
    const { ctx, id } = await newStudent()
    await expectDbError(adminSql()`update students set email_status = 'verified' where id = ${id}`, '42501')
    // editing other details keeps the verification status
    await pp.sendEmailVerification(ctx, id)
    const s0 = (await students.getStudent(ctx, id))!.student
    await students.updateStudent(ctx, id, { originatingOrgId: EDX, fullName: 'Phase Two Renamed', phone: s0.phone, email: s0.email })
    expect((await students.getStudent(ctx, id))!.student.email_status).toBe('pending')
    await expectDbError(as('edx.manager@demo.test', (tx) => tx`update students set email_status = 'verified' where id = ${id}`), '42501')
    await pp.sendEmailVerification(ctx, id)
    const token = await tokenFor(id)
    await adminSql()`update auth_private.email_verifications set expires_at = now() - interval '1 minute' where student_id = ${id}`
    expect(await pp.confirmEmailVerification(token)).toBe('expired')
    expect((await students.getStudent(ctx, id))!.student.email_status).toBe('expired')
    const seen = await as('edx.counsellor@demo.test', (tx) => tx`select id from notification_messages where student_id = ${id} and event_key = 'email_verification'`)
    expect(seen).toHaveLength(0)
  })
})
