/** Phase C: verification rules, immutable verification records, two-person approval, annotations, view vs download. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as documents from '@/services/documents'
import * as students from '@/services/students'
import * as rules from '@/services/verification-rules'
import { adminSql, as, ctxFor, expectDbError, orgId, delegateToSystemAdmin, securityClear } from '../support/helpers'
beforeAll(async () => { await delegateToSystemAdmin(['verification.rules.manage']) }) // the MD has delegated these to the System Administrator (test setup)

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const pdf = (text = 'nothing relevant') => new File([Buffer.from(`%PDF-1.4\n% ${text}\n`)], 'doc.pdf', { type: 'application/pdf' })
const countryId = async (code: string) => (await adminSql()`select id from countries where code = ${code}`)[0].id as string

beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}

/** A fresh EDX student educated in the given country, with an uploaded Bonafide certificate. */
async function bonafideFor(country = 'QA') {
  const mgr = await ctxFor('edx.manager@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Phase C Student', phone: `+91 90050 ${rand()}`, previousEducationCountryId: await countryId(country) })
  if (!r.ok) throw new Error()
  // assign documentation staff so they can see the student
  const docs = await ctxFor('docs@demo.test')
  await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
  const cl = await documents.getChecklist(mgr, r.id)
  const doc = cl.items.find((i) => i.type_key === 'bonafide_certificate')!
  await documents.uploadDocument(docs, doc.id, pdf())
  return { mgr, docs, studentId: r.id, docId: doc.id }
}

describe('verification rules', () => {
  it('apply by previous-education country (Qatar wording for a Qatar-educated student)', async () => {
    const { docs, docId } = await bonafideFor('QA')
    const review = await documents.getDocumentReview(docs, docId)
    const texts = review!.requirements.map((r) => r.text)
    expect(texts).toContain('eligible to pursue higher education in Qatar and abroad')
    expect(texts).not.toContain('eligible to pursue higher education in India and abroad')
    expect(review!.unmet).toBe(2) // phrase + signature are mandatory; keywords optional
  })

  it('drafts have no effect until approved; approved rules are frozen; new versions retire old ones', async () => {
    const admin = await ctxFor('admin@demo.test') // can draft, cannot approve
    const md = await ctxFor('md@demo.test')
    const docTypeId = (await adminSql()`select id from document_types where key = 'migration_certificate'`)[0].id
    const ruleId = await rules.saveRuleDraft(admin, null, { name: 'Test migration rule', documentTypeId: docTypeId })
    await rules.addRequirement(admin, ruleId, { kind: 'manual_check', text: 'Issued by the board' })
    await expectServiceError(rules.approveRule(admin, ruleId), 'forbidden')
    await rules.approveRule(md, ruleId)
    await expectServiceError(rules.addRequirement(admin, ruleId, { kind: 'manual_check', text: 'Sneaky extra check' }), 'forbidden')
    await expectDbError(adminSql()`update verification_rules set name = 'changed' where id = ${ruleId}`, '42501')
    const v2 = await rules.newRuleVersion(admin, ruleId)
    await rules.addRequirement(admin, v2, { kind: 'manual_check', text: 'Has a serial number' })
    await rules.approveRule(md, v2)
    const [old] = await adminSql()`select status, effective_to from verification_rules where id = ${ruleId}`
    expect(old.status).toBe('retired')
    const [nw] = await adminSql()`select version, status from verification_rules where id = ${v2}`
    expect(nw).toMatchObject({ version: 2, status: 'approved' })
  })
})

describe('verify → submit → approval by a different person', () => {
  it('cannot be verified until every mandatory check is ticked present', async () => {
    const { docs, docId } = await bonafideFor('QA')
    await expectServiceError(documents.documentAction(docs, docId, 'verify'), 'invalid')
    const req = (await documents.getDocumentReview(docs, docId))!.requirements
    await expectServiceError(documents.recordVerification(docs, docId, req[0].id, 'absent'), 'invalid') // comment required
    await documents.recordVerification(docs, docId, req[0].id, 'absent', 'Wording missing')
    for (const r of req.filter((x) => x.is_mandatory)) await documents.recordVerification(docs, docId, r.id, 'present', undefined, true)
    const mandatoryNA = req.find((x) => x.is_mandatory)!
    await expectServiceError(documents.recordVerification(docs, docId, mandatoryNA.id, 'not_applicable'), 'invalid')
    await documents.documentAction(docs, docId, 'verify')
    await documents.documentAction(docs, docId, 'submit')
    const [d] = await adminSql()`select status from student_documents where id = ${docId}`
    expect(d.status).toBe('pending_approval')
  })

  async function submitted() {
    const ctx = await bonafideFor('IN')
    for (const r of (await documents.getDocumentReview(ctx.docs, ctx.docId))!.requirements.filter((x) => x.is_mandatory)) {
      await documents.recordVerification(ctx.docs, ctx.docId, r.id, 'present')
    }
    await documents.documentAction(ctx.docs, ctx.docId, 'verify')
    await documents.documentAction(ctx.docs, ctx.docId, 'submit')
    await securityClear(ctx.docId)
    return ctx
  }

  it('documentation staff cannot approve; the manager who verified cannot approve their own work', async () => {
    const { docs, docId, mgr } = await submitted()
    await expectServiceError(documents.documentAction(docs, docId, 'approve'), 'forbidden')
    // a manager who verifies and submits a document cannot then approve it
    const other = await bonafideFor('IN')
    for (const r of (await documents.getDocumentReview(mgr, other.docId))!.requirements.filter((x) => x.is_mandatory)) {
      await documents.recordVerification(mgr, other.docId, r.id, 'present')
    }
    await documents.documentAction(mgr, other.docId, 'verify')
    await documents.documentAction(mgr, other.docId, 'submit')
    await securityClear(other.docId)
    await expectServiceError(documents.documentAction(mgr, other.docId, 'approve'), 'forbidden')
    // the other demo approver (MD) can
    await documents.documentAction(await ctxFor('md@demo.test'), other.docId, 'approve')
    await documents.documentAction(mgr, docId, 'approve')
    const [d] = await adminSql()`select status, approved_file_id = current_file_id as same from student_documents where id = ${docId}`
    expect(d).toMatchObject({ status: 'approved', same: true })
  })

  it('a new upload resets verification and approval; old checks do not count for the new version', async () => {
    const { docs, docId, mgr } = await submitted()
    await documents.documentAction(mgr, docId, 'approve')
    await documents.uploadDocument(docs, docId, pdf('version two'))
    const review = (await documents.getDocumentReview(docs, docId))!
    expect(review.doc.status).toBe('uploaded')
    expect(review.doc.approved_file_id).toBeNull()
    expect(review.unmet).toBe(2)
    expect(review.verifications.length).toBeGreaterThan(0) // history kept
    const tl = await students.getTimeline(mgr, review.doc.student_id)
    expect(tl.some((e) => /previous verification\/approval no longer applies/.test(e.summary))).toBe(true)
  })

  it('a manager can request changes instead of approving (reason required), which needs a new upload', async () => {
    const { docId, mgr, docs } = await submitted()
    await expectServiceError(documents.documentAction(mgr, docId, 'request_changes', ''), 'invalid')
    await documents.documentAction(mgr, docId, 'request_changes', 'Seal not legible')
    await expectServiceError(documents.recordVerification(docs, docId, (await documents.getDocumentReview(docs, docId))!.requirements[0].id, 'present'), 'invalid')
  })

  it('verification records cannot be changed or deleted, even by the database owner', async () => {
    const { docId } = await submitted()
    await expectDbError(adminSql()`update document_verifications set result = 'absent' where student_document_id = ${docId}`, 'P0001')
    await expectDbError(adminSql()`delete from document_verifications where student_document_id = ${docId}`, 'P0001')
  })

  it('status columns cannot be changed directly', async () => {
    const { docId } = await submitted()
    await expectDbError(as('edx.manager@demo.test', (tx) => tx`update student_documents set notes = 'x', expiry_date = null where id = ${docId}`).then(async () => {
      await adminSql()`update student_documents set status = 'approved' where id = ${docId}`
    }), '42501')
  })
})

describe('viewing, downloading and comments', () => {
  it('viewing needs documents.file.view (audited); downloading needs documents.download', async () => {
    const { docs, docId, mgr } = await bonafideFor('IN')
    const fileId = (await documents.getDocumentReview(docs, docId))!.viewFile!.id
    const content = await documents.fileContent(docs, fileId)
    expect(content?.mime).toBe('application/pdf')
    expect(content?.data.subarray(0, 5).toString()).toBe('%PDF-')
    expect(await documents.fileContent(await ctxFor('edx.counsellor@demo.test'), fileId)).toBeNull()
    expect(await documents.openFile(mgr, fileId)).toMatch(/^\/api\/storage\/local/)
    // the CEO can see statuses but cannot view or download files
    expect(await documents.fileContent(await ctxFor('ceo@demo.test'), fileId)).toBeNull()
    expect(await documents.openFile(await ctxFor('ceo@demo.test'), fileId)).toBeNull()
  })

  it('comments are tied to a file version and page; immutable; hidden from users who cannot view the file', async () => {
    const { docs, docId } = await bonafideFor('IN')
    const fileId = (await documents.getDocumentReview(docs, docId))!.viewFile!.id
    await documents.addAnnotation(docs, fileId, 1, [{ x: 0.1, y: 0.2, w: 0.5, h: 0.03 }, { x: 9, y: -1, w: 'bad', h: 0.1 }], 'eligible to pursue', 'Check this sentence')
    const ann = (await documents.getDocumentReview(docs, docId))!.annotations
    expect(ann).toHaveLength(1)
    expect(ann[0]).toMatchObject({ page: 1, quote: 'eligible to pursue', body: 'Check this sentence' })
    expect(ann[0].rects[1]).toEqual({ x: 1, y: 0, w: 0, h: 0.1 }) // clamped
    await expectServiceError(documents.addAnnotation(await ctxFor('edx.counsellor@demo.test'), fileId, 1, [], undefined, 'x'), 'forbidden')
    await expectDbError(adminSql()`delete from document_annotations where file_id = ${fileId}`, 'P0001')
  })
})
