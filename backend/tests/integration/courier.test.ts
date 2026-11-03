/** Original documents by courier: scan → approval → courier instructions → dispatch → receipt → reconciliation. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous, db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as courier from '@/services/courier'
import * as documents from '@/services/documents'
import * as students from '@/services/students'
import { adminSql, ctxFor, expectDbError, orgId, securityClear } from '../support/helpers'

let EDX: string; let GRD: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const pdf = () => new File([Buffer.from('%PDF-1.4\n% fictional\n')], 'd.pdf', { type: 'application/pdf' })
beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}

async function address(org = EDX) {
  const admin = await ctxFor('md@demo.test')
  return courier.saveCourierAddress(admin, null, { orgId: org, label: `Test office ${rand()}`, recipient: 'Documents Desk (fictional)',
    address: '1 Example Street\nTest City 000000', phone: '+91 00000 00000', instructions: 'Use a sealed envelope.' })
}

/** Student with an APPROVED Plus Two scan and a passport item that is NOT approved. */
async function setup() {
  const mgr = await ctxFor('edx.manager@demo.test')
  const docs = await ctxFor('docs@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Courier Student', phone: `+91 90094 ${rand()}` })
  if (!r.ok) throw new Error()
  await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
  const items = (await documents.getChecklist(mgr, r.id)).items
  const plusTwo = items.find((i) => i.type_key === 'plus_two_certificate')!
  const passport = items.find((i) => i.type_key === 'passport')!
  await documents.uploadDocument(docs, plusTwo.id, pdf())
  for (const q of (await documents.getDocumentReview(docs, plusTwo.id))!.requirements.filter((x) => x.is_mandatory)) {
    await documents.recordVerification(docs, plusTwo.id, q.id, 'present')
  }
  await documents.documentAction(docs, plusTwo.id, 'verify')
  await documents.documentAction(docs, plusTwo.id, 'submit')
  await securityClear(plusTwo.id)
  await documents.documentAction(mgr, plusTwo.id, 'approve')
  return { mgr, docs, studentId: r.id, approved: plusTwo.id, notApproved: passport.id }
}

async function portalToken(studentId: string) {
  const token = `test-${rand()}-${Date.now()}`
  await adminSql()`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${token}, ${[studentId]}, ${studentId})`
  return token
}

describe('originals by courier', () => {
  it('instructions only after scan approval; the address reaches the portal only then', async () => {
    const addr = await address()
    const s = await setup()
    const token = await portalToken(s.studentId)
    const none = await anonymous((tx) => tx<{ x: unknown[] }[]>`select app.portal_shipments(${token}) as x`)
    expect(none[0].x).toEqual([])
    // not approved → refused (no exception permission for a manager)
    const e = await expectServiceError(courier.issueInstructions(s.mgr, s.studentId, addr, [s.notApproved]))
    expect(e.message).toMatch(/only after the scans are approved/)
    await expectServiceError(courier.issueInstructions(s.mgr, s.studentId, addr, [s.notApproved], 'urgent'))
    // a GRADUATER address cannot be used for an Edulinks student
    await expectServiceError(courier.issueInstructions(s.mgr, s.studentId, await address(GRD), [s.approved]))
    // approved → issued
    const id = await courier.issueInstructions(s.mgr, s.studentId, addr, [s.approved])
    await expectServiceError(courier.issueInstructions(s.mgr, s.studentId, addr, [s.approved])) // already open
    const [{ x }] = await anonymous((tx) => tx<{ x: { id: string; address: string; status: string; documents: string[] }[] }[]>`select app.portal_shipments(${token}) as x`)
    expect(x).toHaveLength(1)
    expect(x[0]).toMatchObject({ id, status: 'instructions_issued' })
    expect(x[0].address).toMatch(/1 Example Street/)
    // another student's session sees nothing and cannot submit
    const other = await setup()
    const otherToken = await portalToken(other.studentId)
    expect((await anonymous((tx) => tx<{ x: unknown[] }[]>`select app.portal_shipments(${otherToken}) as x`))[0].x).toEqual([])
    await expectDbError(anonymous((tx) => tx`select app.portal_submit_courier(${otherToken}, ${id}, 'DHL', 'X1', null)`), 'P0002')

    // student submits courier details in the portal
    await anonymous((tx) => tx`select app.portal_submit_courier(${token}, ${id}, 'Fictional Express', 'FX123456', current_date)`)
    let data = (await courier.getStudentShipments(s.mgr, s.studentId))!
    expect(data.shipments[0]).toMatchObject({ status: 'dispatched', courier_company: 'Fictional Express', tracking_number: 'FX123456', dispatch_source: 'portal' })

    // staff: in transit → received (custody recorded) → reconcile
    await expectServiceError(courier.reconcileShipment(s.mgr, id, [])) // not received yet
    await courier.setShipmentStatus(s.mgr, id, 'in_transit')
    await courier.setShipmentStatus(s.mgr, id, 'received')
    const [doc] = await adminSql()`select original_location from student_documents where id = ${s.approved}`
    expect(doc.original_location).toBe('with_staff')
    await expectDbError(anonymous((tx) => tx`select app.portal_submit_courier(${token}, ${id}, 'Other', 'Y1', null)`), '23514') // locked after receipt
    data = (await courier.getStudentShipments(s.mgr, s.studentId))!
    const item = data.shipments[0].items[0]
    await expectServiceError(courier.reconcileShipment(s.mgr, id, [{ id: item.id, result: 'mismatch' }]), 'invalid')
    expect(await courier.reconcileShipment(s.mgr, id, [{ id: item.id, result: 'mismatch', note: 'Seal differs from the scan' }])).toBe('reconciliation_required')
    const [task] = await adminSql()`select task_type, status from tasks where source_key like ${'courier-mismatch:' + id + '%'}`
    expect(task).toMatchObject({ task_type: 'courier' })
    expect(await courier.reconcileShipment(s.mgr, id, [{ id: item.id, result: 'matches' }])).toBe('completed')
    data = (await courier.getStudentShipments(s.mgr, s.studentId))!
    expect(data.shipments[0].events.map((e) => e.action)).toEqual(['completed', 'reconciliation_required', 'received', 'in_transit', 'dispatched', 'instructions_issued'])
  })

  it('exceptions need courier.exception and a reason, and are audited; records cannot be edited directly', async () => {
    const addr = await address()
    const s = await setup()
    const md = await ctxFor('md@demo.test')
    await expectServiceError(courier.issueInstructions(md, s.studentId, addr, [s.notApproved]), 'invalid') // reason required
    const id = await courier.issueInstructions(md, s.studentId, addr, [s.notApproved], 'Original needed urgently for the embassy (test)')
    const [sh] = await adminSql()`select exception_reason from original_shipments where id = ${id}`
    expect(sh.exception_reason).toMatch(/embassy/)
    const audit = await adminSql()`select 1 from audit_logs where action = 'courier_exception' and entity_id = ${id}`
    expect(audit).toHaveLength(1)
    await expectDbError(adminSql()`update original_shipments set status = 'completed' where id = ${id}`, '42501')
    await expectDbError(adminSql()`delete from original_shipment_events where shipment_id = ${id}`, 'P0001')
    // cancelling needs a reason
    await expectServiceError(courier.setShipmentStatus(md, id, 'cancelled'), 'invalid')
    await courier.setShipmentStatus(md, id, 'cancelled', 'Issued by mistake')
    // staff without custody permission cannot issue
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    await expectServiceError(courier.issueInstructions(counsellor, s.studentId, addr, [s.approved]))
  })

  it('only company administrators manage delivery addresses', async () => {
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    await expectServiceError(courier.saveCourierAddress(counsellor, null, { orgId: EDX, label: 'X office', recipient: 'Someone', address: 'Somewhere 1' }))
    await expectServiceError(courier.saveCourierAddress(await ctxFor('md@demo.test'), null, { orgId: EDX, label: '', recipient: '', address: '' }), 'invalid')
  })
})
