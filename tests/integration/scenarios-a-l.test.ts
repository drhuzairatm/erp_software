/**
 * Phase C – complete admissions scenarios A–L, end to end through the real services and database rules.
 * Every student, document and payment here is fictional (synthetic test data).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/server/db'
import { ServiceError } from '@/server/errors'
import * as ac from '@/server/services/academic'
import * as att from '@/server/services/attestation'
import * as documents from '@/server/services/documents'
import * as pp from '@/server/services/passport'
import * as payments from '@/server/services/payments'
import * as rq from '@/server/services/requirements'
import * as students from '@/server/services/students'
import { adminSql, ctxFor, orgId, securityClear } from '../support/helpers'

let EDX: string
let SERVICE: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const country = async (code: string) => (await adminSql()`select id from countries where code = ${code}`)[0].id as string
const course = async (code: string) => (await adminSql()`select id from courses where code = ${code}`)[0].id as string
const pdf = (t = 'fictional scan') => new File([new TextEncoder().encode(`%PDF-1.4\n% ${t}\n%%EOF`)], 'scan.pdf', { type: 'application/pdf' })
const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
type C = Awaited<ReturnType<typeof ctxFor>>
let mgr: C, docs: C, fin: C, fin2: C

beforeAll(async () => {
  EDX = await orgId('EDX')
  SERVICE = (await adminSql()`select id from fee_categories where org_id = ${EDX} and kind = 'service' order by name limit 1`)[0].id
  mgr = await ctxFor('edx.manager@demo.test'); docs = await ctxFor('docs@demo.test')
  fin = await ctxFor('edx.finance@demo.test'); fin2 = await ctxFor('edx.finance2@demo.test')
})
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}

/** Register a fictional student (complete contacts; passport only when given). */
async function register(name: string, v: Record<string, unknown>) {
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: name, phone: `+91 90071 ${rand()}`, phone2: `+91 90072 ${rand()}`,
    email: `scenario.${rand()}@example.test`, ...v })
  if (!r.ok) throw new Error('duplicate')
  await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
  return r.id
}
const item = async (id: string, key: string) => (await documents.getChecklist(mgr, id)).items.find((i) => i.type_key === key)
async function plusTwo(id: string, marks: Record<string, number>, name?: string) {
  await ac.saveRecord(mgr, id, null, { kind: 'plus_two', gradingSystem: 'marks', totalMarks: String(Object.keys(marks).length * 100), yearOfPassing: '2026',
    ...(name ? { nameOnCertificate: name } : {}) }, Object.entries(marks).map(([key, m]) => ({ key, name: key, max: '100', obtained: String(m) })))
}
/** Upload → verify all mandatory checks → submit → manual security clearance (no scanner in tests) → manager approval. */
async function approve(docId: string) {
  await documents.uploadDocument(docs, docId, pdf())
  for (const q of (await documents.getDocumentReview(docs, docId))!.requirements.filter((x) => x.is_mandatory)) await documents.recordVerification(docs, docId, q.id, 'present')
  await documents.documentAction(docs, docId, 'verify')
  await documents.documentAction(docs, docId, 'submit')
  await securityClear(docId)
  await documents.documentAction(mgr, docId, 'approve')
}
const status = async (docId: string) => (await adminSql()`select status from student_documents where id = ${docId}`)[0].status as string
const stage = async (id: string) => (await adminSql()`select current_stage_key from students where id = ${id}`)[0].current_stage_key as string

describe('Admissions scenarios A–L (fictional students)', () => {
  it('A. Plus Two student → MBBS (Bulgaria): registration, checklist, academic record, approved document, fee recorded and verified, stage progress', async () => {
    const id = await register('Scenario A Mbbs Student', { destinationCountryId: await country('BG'), courseId: await course('MBBS'),
      passportNumber: `SA${rand()}`, passportExpiry: inDays(1500) })
    const keys = (await documents.getChecklist(mgr, id)).items.map((i) => i.type_key)
    expect(keys).toEqual(expect.arrayContaining(['passport', 'tenth_certificate', 'plus_two_certificate', 'birth_certificate']))
    await plusTwo(id, { physics: 72, chemistry: 75, biology: 80, english: 70 })
    const [adv] = await rq.studentAdvisories(mgr, id)
    expect(adv).toMatchObject({ academic_status: 'meets' })
    await rq.acknowledgeAdvisory(mgr, id, adv.notice_id)
    const p2 = (await item(id, 'plus_two_certificate'))!
    await approve(p2.id)
    expect(await status(p2.id)).toBe('approved')
    // fee: charge and receipt by finance; verification by a different finance person
    const charge = await payments.recordEntry(fin, id, { orgId: EDX, feeCategoryId: SERVICE, entryDate: inDays(0), entryType: 'charge', amount: '150000', currency: 'INR' })
    const rec = await payments.recordEntry(fin, id, { orgId: EDX, feeCategoryId: SERVICE, entryDate: inDays(0), entryType: 'receipt', amount: '50000', currency: 'INR', method: 'bank_transfer', referenceNo: `RA${rand()}` })
    await expectServiceError(payments.verifyEntry(fin, rec, 'verified'), 'forbidden') // no self-verification
    await payments.verifyEntry(fin2, rec, 'verified')
    void charge
    const ledger = (await payments.studentLedger(fin, id))!
    expect(JSON.stringify(ledger)).toMatch(/100000/) // 150 000 due − 50 000 received
    await students.changeStage(mgr, id, { toStage: 'registration' })
    expect(await students.changeStage(mgr, id, { toStage: 'university_application', acknowledge: 'yes' })).toEqual({ ok: true })
    expect(await stage(id)).toBe('university_application')
  })

  it('B. Plus Two student → Nursing (Germany): the Nursing – Germany workflow and its documents apply', async () => {
    const id = await register('Scenario B Nursing Student', { destinationCountryId: await country('DE'), courseId: await course('NURSING'),
      passportNumber: `SB${rand()}`, passportExpiry: inDays(1500) })
    const keys = (await documents.getChecklist(mgr, id)).items.map((i) => i.type_key)
    expect(keys).toEqual(expect.arrayContaining(['language_certificate', 'translated_documents', 'plus_two_certificate']))
    expect((await ac.getAcademic(mgr, id))!.profile).toBe('school')
    await plusTwo(id, { physics: 60, chemistry: 62, biology: 70, english: 75 })
    await students.changeStage(mgr, id, { toStage: 'registration' })
    expect(await stage(id)).toBe('registration')
  })

  it('C. MBBS graduate → Postgraduate Medical: graduate academic profile (MBBS, internship, registration), not Plus Two', async () => {
    const id = await register('Scenario C Pg Doctor', { courseId: await course('PG_MEDICAL'), passportNumber: `SC${rand()}`, passportExpiry: inDays(1500) })
    expect((await ac.getAcademic(mgr, id))!.profile).toBe('pg_medical')
    await ac.saveRecord(mgr, id, null, { kind: 'mbbs', nameOnCertificate: 'SCENARIO C PG DOCTOR', yearOfPassing: '2024', institution: 'Fictional Medical College' }, [])
    await ac.saveRecord(mgr, id, null, { kind: 'internship', nameOnCertificate: 'DR SCENARIO C PG DOCTOR', startDate: '2024-01-01', endDate: '2024-12-31' }, [])
    await ac.saveRecord(mgr, id, null, { kind: 'medical_registration', registrationAuthority: 'State Medical Council (fictional)', registrationNumber: `REG-${rand()}` }, [])
    const kinds = (await ac.getAcademic(mgr, id))!.records.map((r) => r.kind).sort()
    expect(kinds).toEqual(['internship', 'mbbs', 'medical_registration'])
    await students.changeStage(mgr, id, { toStage: 'registration' })
    expect(await stage(id)).toBe('registration')
  })

  it('D. Missing academic certificates: registration is not blocked; the missing items are listed as missing', async () => {
    const id = await register('Scenario D Missing Docs', { destinationCountryId: await country('BG'), courseId: await course('MBBS'),
      passportNumber: `SD${rand()}`, passportExpiry: inDays(1500) })
    const items = (await documents.getChecklist(mgr, id)).items.filter((i) => ['tenth_certificate', 'plus_two_certificate'].includes(i.type_key))
    expect(items.map((i) => i.status)).toEqual(['missing', 'missing'])
    expect(items.every((i) => i.is_required)).toBe(true)
    await students.changeStage(mgr, id, { toStage: 'registration' })
    expect(await stage(id)).toBe('registration')
    const [adv] = await rq.studentAdvisories(mgr, id)
    expect(adv.academic_status).toBe('missing') // advisory, not a block
  })

  it('E. Name mismatch: certificate name differs from the passport holder name → a review is opened; staff decide with a note', async () => {
    const id = await register('Scenario E Name Varma', { passportNumber: `SE${rand()}`, passportExpiry: inDays(1500) })
    const [cur] = await adminSql()`select passport_number, expiry_date::text from student_passports where student_id = ${id} and is_current`
    await pp.recordPassport(mgr, id, { kind: 'correction', passportNumber: cur.passport_number, holderName: 'SCENARIO ESWAR NAME VARMA', expiryDate: cur.expiry_date, notes: 'Holder name added' })
    await plusTwo(id, { physics: 70, chemistry: 70, biology: 70, english: 70 }, 'SCENARIO E NAME VARMA')
    const [c] = (await ac.getAcademic(mgr, id))!.checks
    expect(c.review_status).toBe('open')
    expect(c.mismatch_types.length).toBeGreaterThan(0)
    await expectServiceError(ac.reviewNameCheck(await ctxFor('edx.counsellor@demo.test'), c.id, 'no_action', 'ok'), 'forbidden')
    await ac.reviewNameCheck(docs, c.id, 'no_action', 'Initial accepted by the university (fictional)')
    expect((await ac.getAcademic(mgr, id))!.checks[0].review_status).not.toBe('open')
  })

  it('F. No passport: registration is allowed; the passport validity rule stops University Application until a passport is recorded', async () => {
    const id = await register('Scenario F No Passport', { destinationCountryId: await country('BG'), courseId: await course('MBBS') })
    const s = (await students.getStudent(mgr, id))!.student
    expect(s.passport_number ?? null).toBeNull()
    await students.changeStage(mgr, id, { toStage: 'registration' })
    expect(await stage(id)).toBe('registration')
    await expectServiceError(students.changeStage(mgr, id, { toStage: 'university_application', acknowledge: 'yes' }), 'invalid')
    await pp.recordPassport(mgr, id, { kind: 'initial', passportNumber: `SF${rand()}`, holderName: 'SCENARIO F NO PASSPORT', expiryDate: inDays(1500) })
    const pend = (await pp.getPassportData(mgr, id))!.pending
    if (pend) await pp.verifyPassport(docs, pend.id, 'verified', 'Checked against the scan (fictional)') // a new passport counts only after verification
    expect(await students.changeStage(mgr, id, { toStage: 'university_application', acknowledge: 'yes' })).toEqual({ ok: true })
  })

  it('G. Expired passport: registration allowed; passport flagged and follow-up tasks created; University Application blocked until renewed', async () => {
    const id = await register('Scenario G Expired Passport', { destinationCountryId: await country('BG'), courseId: await course('MBBS'),
      passportNumber: `SG${rand()}`, passportExpiry: inDays(-20) })
    expect(['expired', 'critical']).toContain((await students.getStudent(mgr, id))!.student.passport_status)
    const tasks = await adminSql()`select title from tasks where student_id = ${id} and task_type = 'passport'`
    expect(tasks.length).toBeGreaterThan(0)
    await students.changeStage(mgr, id, { toStage: 'registration' })
    await expectServiceError(students.changeStage(mgr, id, { toStage: 'university_application', acknowledge: 'yes' }), 'invalid')
  })

  it('H. Bulgaria applicant below the academic requirement: advisory warning + acknowledgement + follow-up task, never a block', async () => {
    const id = await register('Scenario H Bulgaria Below', { destinationCountryId: await country('BG'), courseId: await course('MBBS'),
      passportNumber: `SH${rand()}`, passportExpiry: inDays(1500) })
    await plusTwo(id, { physics: 55, chemistry: 50, biology: 75, english: 80 })
    const [a] = await rq.studentAdvisories(mgr, id)
    expect(a).toMatchObject({ title: 'BULGARIA – IMPORTANT ACADEMIC REQUIREMENTS', academic_status: 'below', requires_acknowledgement: true })
    await rq.acknowledgeAdvisory(mgr, id, a.notice_id)
    expect((await adminSql()`select title from tasks where student_id = ${id} and source_key like 'adv:%'`)[0].title).toMatch(/Academic verification/)
    await students.changeStage(mgr, id, { toStage: 'registration' })
    expect(await students.changeStage(mgr, id, { toStage: 'university_application', acknowledge: 'yes' })).toEqual({ ok: true })
  })

  it('I. Egypt applicant: no invented Egypt requirement appears; a configured (test-only) Egypt notice is advisory with acknowledgement and never blocks', async () => {
    const id = await register('Scenario I Egypt Student', { destinationCountryId: await country('EG'), courseId: await course('MBBS'),
      passportNumber: `SI${rand()}`, passportExpiry: inDays(1500) })
    const real = (await rq.studentAdvisories(mgr, id)).filter((x) => x.country === 'Egypt' && !/TEST/.test(x.title))
    expect(real).toHaveLength(0) // the MD has not supplied Egypt requirements, so none exist
    const md = await ctxFor('md@demo.test')
    const title = `TEST-ONLY EGYPT ACADEMIC NOTICE ${rand()}`
    const group = await rq.saveRequirement(md, null, { destinationCountryId: await country('EG'), category: 'academic_marks', displayType: 'mandatory_notice', priority: 'high',
      title, message: 'Fictional requirement used only by the automated test.', requiresAcknowledgement: 'yes' },
      [{ record_kind: 'plus_two', subject_key: 'biology', subject_name: 'Biology', min_percentage: '50' }])
    try {
      const a = (await rq.studentAdvisories(mgr, id)).find((x) => x.title === title)!
      expect(a.requires_acknowledgement).toBe(true)
      await rq.acknowledgeAdvisory(mgr, id, a.notice_id)
      await students.changeStage(mgr, id, { toStage: 'registration' })
      expect(await students.changeStage(mgr, id, { toStage: 'university_application', acknowledge: 'yes' })).toEqual({ ok: true })
    } finally {
      await rq.setRequirementStatus(md, String(group), false, 'Test-only notice removed after the automated test')
    }
  })

  it('J. One and Same: mandatory rule → checklist item → template preview → request → document verified and approved', async () => {
    const md = await ctxFor('md@demo.test')
    await adminSql()`insert into one_and_same_rules (name, mismatch_type, requirement, is_active, created_by)
      select 'Scenario J missing surname (test)', 'missing_surname', 'mandatory', true, ${md.userId}
       where not exists (select 1 from one_and_same_rules where name = 'Scenario J missing surname (test)')`
    await adminSql()`update one_and_same_rules set is_active = true where name = 'Scenario J missing surname (test)'`
    try {
      const id = await register('Scenario J Oneandsame', { passportNumber: `SJ${rand()}`, passportExpiry: inDays(1500) })
      const [cur] = await adminSql()`select passport_number, expiry_date::text from student_passports where student_id = ${id} and is_current`
      await pp.recordPassport(mgr, id, { kind: 'correction', passportNumber: cur.passport_number, holderName: 'TEJASWI SCENARIOJ', expiryDate: cur.expiry_date, notes: 'Holder name' })
      await plusTwo(id, { physics: 70, chemistry: 70, biology: 70, english: 70 }, 'TEJASWI')
      const c = (await ac.getAcademic(mgr, id))!.checks[0]
      expect(c).toMatchObject({ requirement: 'mandatory', case_status: 'mandatory' })
      const oas = (await item(id, 'one_and_same'))!
      expect(oas).toMatchObject({ is_required: true, status: 'missing' })
      const [tpl] = await adminSql()`select id from one_and_same_templates where status = 'approved' limit 1`
      await ac.prepareOneAndSame(mgr, c.case_id!, tpl.id)
      await ac.requestOneAndSame(mgr, c.case_id!, 'manual', 'Phoned the student (fictional)')
      expect((await ac.getAcademic(mgr, id))!.checks[0].case_status).toBe('pending')
      await approve(oas.id)
      expect((await ac.getAcademic(mgr, id))!.checks[0].case_status).toBe('approved')
    } finally {
      await adminSql()`update one_and_same_rules set is_active = false where name = 'Scenario J missing surname (test)'`
    }
  })

  it('K. Document corrections: manager returns the document with a comment → new version uploaded → old checks do not count → verified, cleared, approved; full history kept', async () => {
    const id = await register('Scenario K Corrections', { passportNumber: `SK${rand()}`, passportExpiry: inDays(1500) })
    const d = (await item(id, 'tenth_certificate'))!
    await documents.uploadDocument(docs, d.id, pdf('blurred seal'))
    for (const q of (await documents.getDocumentReview(docs, d.id))!.requirements.filter((x) => x.is_mandatory)) await documents.recordVerification(docs, d.id, q.id, 'present')
    await documents.documentAction(docs, d.id, 'verify'); await documents.documentAction(docs, d.id, 'submit')
    await expectServiceError(documents.documentAction(mgr, d.id, 'request_changes', ''), 'invalid') // a comment is required
    await documents.documentAction(mgr, d.id, 'request_changes', 'Seal not legible – please upload a clearer scan (fictional)')
    expect(await status(d.id)).toBe('changes_required')
    await documents.uploadDocument(docs, d.id, pdf('clear seal'))
    const review = (await documents.getDocumentReview(docs, d.id))!
    expect(review.files.map((f) => f.version)).toEqual([2, 1])
    // the new version starts the review again: back to "uploaded", earlier verification cleared, new file not scanned/cleared
    expect((await adminSql()`select status, verified_by from student_documents where id = ${d.id}`)[0]).toMatchObject({ status: 'uploaded', verified_by: null })
    expect(review.files[0].scan_status).toBe('not_scanned')
    await expectServiceError(documents.documentAction(mgr, d.id, 'approve')) // not verified/submitted/cleared
    for (const q of review.requirements.filter((x) => x.is_mandatory)) await documents.recordVerification(docs, d.id, q.id, 'present')
    await documents.documentAction(docs, d.id, 'verify'); await documents.documentAction(docs, d.id, 'submit')
    await securityClear(d.id)
    await documents.documentAction(mgr, d.id, 'approve')
    const hist = (await documents.getDocumentReview(mgr, d.id))!.reviews.map((r) => r.to_status)
    expect(hist).toEqual(expect.arrayContaining(['changes_required', 'approved']))
  })

  it('L. Attestation / apostille: an approved India-issued document for Bulgaria starts the matching route; every stage is completed with references', async () => {
    const id = await register('Scenario L Apostille', { destinationCountryId: await country('BG'), previousEducationCountryId: await country('IN'),
      passportNumber: `SL${rand()}`, passportExpiry: inDays(1500) })
    const d = (await item(id, 'plus_two_certificate'))!
    await expectServiceError(att.startAttestation(docs, d.id, (await adminSql()`select id from attestation_routes where status = 'approved' limit 1`)[0].id)) // not approved yet
    await approve(d.id)
    await documents.updateDocumentDetails(mgr, d.id, undefined, undefined, await country('IN'))
    const offered = (await att.getDocumentAttestation(docs, d.id))!.routes
    expect(offered.map((r) => r.name)).toEqual(['[TO CONFIRM] Bulgaria – India-issued documents – Apostille'])
    await att.startAttestation(docs, d.id, offered[0].id)
    for (const s of (await att.getDocumentAttestation(docs, d.id))!.steps) {
      await att.stepAction(docs, s.id, 'start', { reference: `REF-${rand()}` })
      await att.stepAction(docs, s.id, 'complete', {})
    }
    const a = (await att.getDocumentAttestation(docs, d.id))!
    expect(a.steps.every((s) => s.status === 'completed')).toBe(true)
    expect(a.state.state).toBe('completed')
  })
})
