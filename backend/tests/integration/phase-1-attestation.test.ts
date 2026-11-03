/** Phase 1: attestation & apostille engine. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous, db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as att from '@/services/attestation'
import * as documents from '@/services/documents'
import * as students from '@/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId, delegateToSystemAdmin, securityClear } from '../support/helpers'
beforeAll(async () => { await delegateToSystemAdmin(['attestation.routes.manage']) }) // the MD has delegated these to the System Administrator (test setup)

let EDX: string
const country = async (code: string) => (await adminSql()`select id from countries where code = ${code}`)[0].id as string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const pdf = () => new File([Buffer.from('%PDF-1.4\n% fictional\n')], 'd.pdf', { type: 'application/pdf' })
beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}

/** Student going to `dest`, educated in `edu`, with an APPROVED Plus Two certificate issued in `issued`. */
async function approvedDoc(dest = 'BG', edu = 'IN', issued: string | null = 'IN') {
  const mgr = await ctxFor('edx.manager@demo.test')
  const docs = await ctxFor('docs@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Attest Student', phone: `+91 90095 ${rand()}`,
    destinationCountryId: await country(dest), previousEducationCountryId: await country(edu) })
  if (!r.ok) throw new Error()
  await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
  const doc = (await documents.getChecklist(mgr, r.id)).items.find((i) => i.type_key === 'plus_two_certificate')!
  await documents.uploadDocument(docs, doc.id, pdf())
  for (const q of (await documents.getDocumentReview(docs, doc.id))!.requirements.filter((x) => x.is_mandatory)) {
    await documents.recordVerification(docs, doc.id, q.id, 'present')
  }
  await documents.documentAction(docs, doc.id, 'verify')
  await documents.documentAction(docs, doc.id, 'submit')
  await securityClear(doc.id)
  await documents.documentAction(mgr, doc.id, 'approve')
  if (issued) await documents.updateDocumentDetails(mgr, doc.id, undefined, undefined, await country(issued))
  return { mgr, docs, studentId: r.id, docId: doc.id }
}

const routeByName = async (like: string) => (await adminSql()`select id from attestation_routes where name like ${like} and status = 'approved'`)[0].id as string

describe('routes: draft → MD approval → frozen versions', () => {
  it('an administrator drafts, only the MD approves; approved routes are frozen; new versions retire old ones', async () => {
    const admin = await ctxFor('admin@demo.test')
    const md = await ctxFor('md@demo.test')
    const id = await att.saveRouteDraft(admin, null, { name: 'Test route Georgia', routeType: 'apostille', destinationCountryId: await country('GE'), issuingCountryId: await country('IN') })
    await expectServiceError(att.approveRoute(md, id), 'invalid') // no stages yet
    await att.addStage(admin, id, { name: 'Apostille', requiresReference: 'yes' })
    await att.addStage(admin, id, { name: 'Translation', optional: 'yes' })
    const stages = (await att.getRoute(admin, id))!.stages
    await att.moveStage(admin, stages[1].id, 'up')
    expect((await att.getRoute(admin, id))!.stages.map((s) => s.name)).toEqual(['Translation', 'Apostille'])
    await expectServiceError(att.approveRoute(admin, id), 'forbidden')
    await att.approveRoute(md, id)
    await expectServiceError(att.addStage(admin, id, { name: 'Sneaky' }), 'forbidden')
    await expectDbError(adminSql()`update attestation_routes set name = 'x' where id = ${id}`, '42501')
    const v2 = await att.newRouteVersion(admin, id)
    await att.approveRoute(md, v2)
    const [old] = await adminSql()`select status from attestation_routes where id = ${id}`
    expect(old.status).toBe('retired')
  })
})

describe('starting attestation', () => {
  it('matches by destination and issuing country; the right route is offered', async () => {
    const india = await approvedDoc('BG', 'IN', 'IN')
    const routes = (await att.getDocumentAttestation(india.docs, india.docId))!.routes.map((r) => r.name)
    expect(routes).toEqual(['[TO CONFIRM] Bulgaria – India-issued documents – Apostille'])
    const uae = await approvedDoc('BG', 'AE', 'AE')
    expect((await att.getDocumentAttestation(uae.docs, uae.docId))!.routes.map((r) => r.name)).toEqual(['[TO CONFIRM] Bulgaria – UAE-issued documents – Legalisation'])
    const noIssuer = await approvedDoc('BG', 'IN', null)
    const s = (await att.getDocumentAttestation(noIssuer.docs, noIssuer.docId))!
    expect(s.state.state).toBeNull()
    expect(s.routes).toHaveLength(0)
  })

  it('only the current, manager-approved version can start; only permitted staff', async () => {
    const d = await approvedDoc()
    const route = await routeByName('%India-issued documents – Apostille')
    for (const email of ['edx.counsellor@demo.test', 'ceo@demo.test']) {
      await expectServiceError(att.startAttestation(await ctxFor(email), d.docId, route))
    }
    const egypt = await routeByName('[TO CONFIRM] Egypt%')
    await expectServiceError(att.startAttestation(d.docs, d.docId, egypt), 'invalid') // wrong destination
    await documents.uploadDocument(d.docs, d.docId, pdf()) // new version → no longer approved
    await expectServiceError(att.startAttestation(d.docs, d.docId, route), 'invalid')
  })
})

describe('stage rules', () => {
  async function started(dest = 'EG') {
    const d = await approvedDoc(dest, 'IN', 'IN')
    const route = dest === 'EG' ? await routeByName('[TO CONFIRM] Egypt%') : await routeByName('%India-issued documents – Apostille')
    await att.startAttestation(d.docs, d.docId, route)
    const a = (await att.getDocumentAttestation(d.docs, d.docId))!
    return { ...d, steps: a.steps, attestationId: a.current!.id }
  }

  it('stages go in order; references required where configured; optional stages can be marked not required', async () => {
    const d = await started('EG')
    const [s1, s2, s3] = d.steps
    await expectServiceError(att.stepAction(d.docs, s3.id, 'complete', { reference: 'X' }), 'invalid') // earlier stages open
    await expectServiceError(att.stepAction(d.docs, s1.id, 'complete', {}), 'invalid') // reference required
    await att.stepAction(d.docs, s1.id, 'start', { reference: 'APO-1' })
    await att.stepAction(d.docs, s1.id, 'complete', {})
    await expectServiceError(att.stepAction(d.docs, s2.id, 'not_required', {}), 'invalid') // reason needed
    await att.stepAction(d.docs, s2.id, 'not_required', { comment: 'Apostille accepted without MEA for this document (test)' })
    await att.stepAction(d.docs, s3.id, 'complete', { reference: 'EMB-9' })
    const a = (await att.getDocumentAttestation(d.docs, d.docId))!
    expect(a.state.state).toBe('completed')
    expect(a.current!.status).toBe('completed')
    const tl = await students.getTimeline(d.mgr, d.studentId)
    expect(tl.some((e) => /attestation completed/.test(e.summary))).toBe(true)
  })

  it('skipping a mandatory stage needs exception permission and a reason (audited)', async () => {
    const d = await started('EG')
    const s1 = d.steps[0]
    await expectServiceError(att.stepAction(d.docs, s1.id, 'not_required', { comment: 'x' }), 'invalid') // mandatory
    await expectServiceError(att.stepAction(d.docs, s1.id, 'exception', { comment: 'urgent' }), 'forbidden') // docs staff lack permission
    await expectServiceError(att.stepAction(d.mgr, s1.id, 'exception', {}), 'invalid')
    await att.stepAction(d.mgr, s1.id, 'exception', { comment: 'University accepted direct submission (test)' })
    const [log] = await adminSql()`select after_data from audit_logs where action = 'attestation_exception' and entity_id = ${s1.id}`
    expect(log.after_data.reason).toContain('University accepted')
  })

  it('a new document version cancels attestation in progress; old completion does not count for the new version', async () => {
    const d = await started('BG')
    await documents.uploadDocument(d.docs, d.docId, pdf())
    const [a] = await adminSql()`select status, cancel_reason from document_attestations where id = ${d.attestationId}`
    expect(a).toMatchObject({ status: 'cancelled' })
    expect((await att.getDocumentAttestation(d.docs, d.docId))!.state.state).toBeNull()
  })

  it('attestation records cannot be changed directly', async () => {
    const d = await started('BG')
    await expectDbError(adminSql()`update document_attestation_steps set status = 'completed' where attestation_id = ${d.attestationId}`, '42501')
    await expectDbError(as('docs@demo.test', (tx) => tx`update document_attestation_steps set status = 'completed' where attestation_id = ${d.attestationId}`), '42501')
  })

  it('work in progress keeps its own copy of the stages when the route changes', async () => {
    const d = await started('EG')
    const admin = await ctxFor('admin@demo.test')
    const md = await ctxFor('md@demo.test')
    const v = await att.newRouteVersion(admin, await routeByName('[TO CONFIRM] Egypt%'))
    await att.addStage(admin, v, { name: 'Extra stage added later' })
    await att.approveRoute(md, v)
    const names = (await att.getDocumentAttestation(d.docs, d.docId))!.steps.map((s) => s.name)
    expect(names).not.toContain('Extra stage added later')
  })

  it('another company cannot see the attestation; the portal shows progress to the student only', async () => {
    const d = await started('BG')
    expect(await att.getDocumentAttestation(await ctxFor('grd.manager@demo.test'), d.docId)).toBeNull()
    const rows = await as('grd.manager@demo.test', (tx) => tx`select id from document_attestations where id = ${d.attestationId}`)
    expect(rows).toHaveLength(0)
    // student portal overview
    const [{ id: sid }] = await adminSql()`select id from students where id = ${d.studentId}`
    const token = 'tok' + rand()
    await adminSql()`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${token}, ${[sid]}, ${sid})`
    const [{ o }] = await anonymous((tx) => tx<{ o: { documents: { id: string; attestation: { state: string; total: number } | null }[] } }[]>`select app.portal_overview(${token}) as o`)
    expect(o.documents.find((x) => x.id === d.docId)?.attestation).toMatchObject({ state: 'processing', total: 1 })
  })

  it('supporting documents are stored privately and opened only by permitted staff', async () => {
    const d = await started('BG')
    await att.uploadStepFile(d.docs, d.steps[0].id, pdf())
    const f = (await att.getDocumentAttestation(d.docs, d.docId))!.files[0]
    expect((await att.attestationFileContent(d.docs, f.id))?.mime).toBe('application/pdf')
    expect(await att.attestationFileContent(await ctxFor('edx.counsellor@demo.test'), f.id)).toBeNull()
    await expectDbError(as('docs@demo.test', (tx) => tx`select storage_key from attestation_step_files limit 1`), '42501')
  })
})
