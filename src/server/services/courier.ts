import { can } from '../auth/context'
import { forbidden, invalid } from '../errors'
import { type Ctx, run } from './base'

const UUID = /^[0-9a-f-]{36}$/i
const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null)

export const SHIPMENT_STATUS: Record<string, { label: string; tone: 'blue' | 'amber' | 'green' | 'red' | 'slate' | 'purple' }> = {
  instructions_issued: { label: 'Courier instructions issued', tone: 'blue' },
  dispatched: { label: 'Original dispatched', tone: 'purple' },
  in_transit: { label: 'In transit', tone: 'purple' },
  received: { label: 'Original received', tone: 'amber' },
  reconciliation_required: { label: 'Reconciliation required', tone: 'red' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
}
/** Ordered steps shown as a tracker */
export const SHIPMENT_STEPS = ['instructions_issued', 'dispatched', 'in_transit', 'received', 'completed'] as const

export interface CourierAddress {
  id: string; org_id: string; org_name: string; label: string; recipient: string; address: string; phone: string | null
  instructions: string | null; is_active: boolean; updated_at: Date
}
export interface Shipment {
  id: string; status: string; address_snapshot: string; instructions: string | null; exception_reason: string | null
  issued_at: Date; issued_by_name: string | null; courier_company: string | null; tracking_number: string | null
  dispatch_date: string | null; expected_delivery: string | null; dispatch_source: string | null; received_at: Date | null
  received_by_name: string | null; completed_at: Date | null; cancelled_reason: string | null
  items: { id: string; document_id: string; name: string; scan_status: string; reconciliation: string; reconciliation_note: string | null }[]
  events: { id: string; action: string; detail: string | null; actor_type: string; actor: string | null; created_at: Date }[]
}

// ---------------------------------------------------------------- addresses (company settings)
export async function listCourierAddresses(ctx: Ctx) {
  return run(ctx, (tx) => tx<CourierAddress[]>`
    select a.id, a.org_id, o.name as org_name, a.label, a.recipient, a.address, a.phone, a.instructions, a.is_active, a.updated_at
      from courier_addresses a join organizations o on o.id = a.org_id order by o.name, a.is_active desc, a.label`)
}

export async function saveCourierAddress(ctx: Ctx, id: string | null, v: Record<string, string | undefined>) {
  const label = v.label?.trim(); const recipient = v.recipient?.trim(); const address = v.address?.trim()
  const errors: Record<string, string[]> = {}
  if (!label || label.length < 2) errors.label = ['Required.']
  if (!recipient || recipient.length < 2) errors.recipient = ['Required.']
  if (!address || address.length < 5) errors.address = ['Enter the full delivery address.']
  if (!id && !(v.orgId && UUID.test(v.orgId))) errors.orgId = ['Choose the company.']
  if (Object.keys(errors).length) throw invalid('Check the highlighted fields.', errors)
  if (!id && !can(ctx, 'settings.manage', v.orgId)) throw forbidden()
  return run(ctx, async (tx) => {
    const [r] = await tx<{ id: string }[]>`select app.save_courier_address(${id}, ${id ? null : v.orgId!}, ${label!}, ${recipient!}, ${address!},
      ${v.phone ?? null}, ${v.instructions ?? null}, ${v.isActive === undefined ? true : v.isActive === 'on' || v.isActive === 'true'}) as id`
    return r.id
  })
}

// ---------------------------------------------------------------- shipments on a student
export async function getStudentShipments(ctx: Ctx, studentId: string) {
  if (!UUID.test(studentId)) return null
  return run(ctx, async (tx) => {
    const shipments = await tx<Omit<Shipment, 'items' | 'events'>[]>`
      select s.id, s.status, s.address_snapshot, s.instructions, s.exception_reason, s.issued_at, iu.full_name as issued_by_name,
             s.courier_company, s.tracking_number, s.dispatch_date::text, s.expected_delivery::text, s.dispatch_source, s.received_at,
             ru.full_name as received_by_name, s.completed_at, s.cancelled_reason
        from original_shipments s left join user_profiles iu on iu.id = s.issued_by left join user_profiles ru on ru.id = s.received_by
       where s.student_id = ${studentId} order by s.issued_at desc`
    const ids = shipments.map((s) => s.id)
    const items = ids.length ? await tx<(Shipment['items'][number] & { shipment_id: string })[]>`
      select i.id, i.shipment_id, i.student_document_id as document_id, t.name || case when d.label <> '' then ' – ' || d.label else '' end as name,
             i.scan_status, i.reconciliation, i.reconciliation_note
        from original_shipment_items i join student_documents d on d.id = i.student_document_id join document_types t on t.id = d.document_type_id
       where i.shipment_id = any(${ids}) order by t.sort_order` : []
    const events = ids.length ? await tx<(Shipment['events'][number] & { shipment_id: string })[]>`
      select e.id::text, e.shipment_id, e.action, e.detail, e.actor_type, u.full_name as actor, e.created_at
        from original_shipment_events e left join user_profiles u on u.id = e.actor where e.shipment_id = any(${ids}) order by e.id desc` : []
    const [perm] = await tx<{ custody: boolean; exception: boolean }[]>`
      select app.can_on_student(${studentId}, 'documents.custody') as custody, app.can_on_student(${studentId}, 'courier.exception') as exception`
    const addresses = await tx<{ id: string; label: string; recipient: string; address: string }[]>`
      select a.id, a.label, a.recipient, a.address from courier_addresses a join students s on s.originating_org_id = a.org_id
       where s.id = ${studentId} and a.is_active order by a.label`
    return {
      shipments: shipments.map((s) => ({ ...s, items: items.filter((i) => i.shipment_id === s.id), events: events.filter((e) => e.shipment_id === s.id) })) as Shipment[],
      canManage: perm.custody, canException: perm.exception, addresses,
    }
  })
}

export async function issueInstructions(ctx: Ctx, studentId: string, addressId: string, documentIds: string[], exception?: string) {
  if (!UUID.test(addressId ?? '')) throw invalid('Choose the delivery address.', { addressId: ['Required.'] })
  const docs = documentIds.filter((d) => UUID.test(d))
  if (!docs.length) throw invalid('Choose the original documents to be sent.', { documents: ['Choose at least one.'] })
  return run(ctx, async (tx) => {
    const [r] = await tx<{ id: string }[]>`select app.issue_courier_instructions(${studentId}, ${addressId}, ${docs}::uuid[], ${exception?.trim() || null}) as id`
    return r.id
  })
}

export async function recordDispatch(ctx: Ctx, shipmentId: string, v: Record<string, string | undefined>) {
  const company = v.courierCompany?.trim(); const tracking = v.trackingNumber?.trim()
  if (!company || !tracking) throw invalid('Enter the courier company and the tracking number.', {
    ...(company ? {} : { courierCompany: ['Required.'] }), ...(tracking ? {} : { trackingNumber: ['Required.'] }) })
  return run(ctx, (tx) => tx`select app.record_courier_dispatch(${shipmentId}, ${company}, ${tracking}, ${date(v.dispatchDate)}, ${date(v.expectedDelivery)})`)
}

export async function setShipmentStatus(ctx: Ctx, shipmentId: string, status: string, note?: string) {
  if (!['in_transit', 'received', 'cancelled'].includes(status)) throw invalid('Unknown action.')
  if (status === 'cancelled' && !note?.trim()) throw invalid('Give the reason for cancelling.', { note: ['Required.'] })
  return run(ctx, (tx) => tx`select app.update_shipment_status(${shipmentId}, ${status}, ${note?.trim() || null})`)
}

export async function reconcileShipment(ctx: Ctx, shipmentId: string, items: { id: string; result: string; note?: string }[]) {
  for (const i of items) {
    if (!['matches', 'mismatch'].includes(i.result)) throw invalid('Choose "matches" or "does not match" for every document.')
    if (i.result === 'mismatch' && !i.note?.trim()) throw invalid('Describe each mismatch.', { [`note_${i.id}`]: ['Required.'] })
  }
  return run(ctx, async (tx) => {
    const [r] = await tx<{ s: string }[]>`select app.reconcile_shipment(${shipmentId}, ${tx.json(items as unknown as Parameters<typeof tx.json>[0])}) as s`
    return r.s
  })
}

/** Open courier shipments across the user's companies (Tasks / dashboards). */
export async function openShipments(ctx: Ctx, limit = 50) {
  return run(ctx, (tx) => tx<{ id: string; student_id: string; student_code: string; full_name: string; status: string; issued_at: Date;
    tracking_number: string | null; courier_company: string | null; documents: number }[]>`
    select s.id, s.student_id, st.student_code, st.full_name, s.status, s.issued_at, s.tracking_number, s.courier_company,
           (select count(*)::int from original_shipment_items i where i.shipment_id = s.id) as documents
      from original_shipments s join v_students st on st.id = s.student_id
     where s.status not in ('completed', 'cancelled') order by s.issued_at limit ${limit}`)
}
