import Link from 'next/link'
import { fmtDate, fmtDateTime } from '@/components/format'
import { NoticeCard } from '@/components/notice'
import { Badge, Card } from '@/components/ui'
import type { Ctx } from '@/services/base'
import { getStudentShipments, SHIPMENT_STATUS, SHIPMENT_STEPS, type Shipment } from '@/services/courier'
import { DispatchForm, IssueInstructionsForm, ReconcileForm, ShipmentStatusButtons } from './courier-forms'

/** Step tracker for one shipment */
export function ShipmentTracker({ status }: { status: string }) {
  const at = status === 'reconciliation_required' ? SHIPMENT_STEPS.indexOf('received') : SHIPMENT_STEPS.indexOf(status as (typeof SHIPMENT_STEPS)[number])
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[11px] font-medium" aria-label="Courier progress">
      {SHIPMENT_STEPS.map((k, i) => {
        const done = status !== 'cancelled' && i <= at
        return (
          <li key={k} className="flex items-center gap-1">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>{done ? '✓' : i + 1}</span>
            <span className={done ? 'text-slate-800' : 'text-slate-400'}>{SHIPMENT_STATUS[k].label}</span>
            {i < SHIPMENT_STEPS.length - 1 && <span className={`mx-1 h-px w-4 ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
          </li>
        )
      })}
    </ol>
  )
}

export async function CourierPanel({ ctx, studentId, editable, documents }: {
  ctx: Ctx; studentId: string; editable: boolean; documents: { id: string; name: string; status: string }[]
}) {
  const data = await getStudentShipments(ctx, studentId)
  if (!data) return null
  const open = new Set(data.shipments.filter((s) => !['completed', 'cancelled'].includes(s.status)).flatMap((s) => s.items.map((i) => i.document_id)))
  const candidates = documents.filter((d) => !open.has(d.id)).map((d) => ({ ...d, approved: d.status === 'approved' }))
  const anyApproved = candidates.some((d) => d.approved)
  return (
    <Card title={<span className="flex items-center gap-2">Originals by courier <span className="text-xs font-normal text-slate-500">scan → approval → courier</span></span>}>
      <div className="space-y-5">
        {data.shipments.length === 0 && (
          <p className="text-sm text-slate-600">No courier instructions yet. Instructions and the delivery address are given to the student only after the scans are approved.</p>
        )}
        {data.shipments.map((s) => <ShipmentCard key={s.id} s={s} studentId={studentId} canManage={data.canManage && editable} />)}
        {data.canManage && editable && (
          <div className="rounded-xl border border-dashed border-slate-300 p-4">
            <p className="mb-3 font-medium">Issue courier instructions</p>
            {data.addresses.length === 0 ? (
              <NoticeCard level="info" title="No delivery address configured">
                An administrator adds the company&apos;s delivery address under <Link href="/admin/courier">Administration → Courier addresses</Link>.
              </NoticeCard>
            ) : !anyApproved && !data.canException ? (
              <p className="text-sm text-slate-600">Available once at least one scan is approved.</p>
            ) : (
              <IssueInstructionsForm studentId={studentId} addresses={data.addresses} documents={candidates} canException={data.canException} />
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

function ShipmentCard({ s, studentId, canManage }: { s: Shipment; studentId: string; canManage: boolean }) {
  const st = SHIPMENT_STATUS[s.status]
  return (
    <section className="rounded-xl border border-slate-200 p-4" aria-label="Courier shipment">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{s.items.map((i) => i.name).join(', ')}</p>
          <p className="text-xs text-slate-500">Instructions issued {fmtDateTime(s.issued_at)} by {s.issued_by_name ?? '—'}</p>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div className="mt-3"><ShipmentTracker status={s.status} /></div>
      {s.exception_reason && <p className="mt-2 text-xs font-medium text-red-700">Issued before scan approval (exception): {s.exception_reason}</p>}
      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-slate-500">Delivery address given</dt><dd className="whitespace-pre-line">{s.address_snapshot}</dd></div>
        <div><dt className="text-xs text-slate-500">Courier</dt><dd>{s.courier_company ?? '—'}{s.tracking_number && <span className="block font-mono">{s.tracking_number}</span>}
          {s.dispatch_source && <span className="block text-xs text-slate-500">{s.dispatch_source === 'portal' ? 'Submitted by the student in the portal' : 'Recorded by staff'}</span>}</dd></div>
        <div><dt className="text-xs text-slate-500">Dates</dt><dd>
          {s.dispatch_date ? <>Sent {fmtDate(s.dispatch_date)}</> : 'Not sent yet'}
          {s.expected_delivery && <span className="block">Expected {fmtDate(s.expected_delivery)}</span>}
          {s.received_at && <span className="block">Received {fmtDateTime(s.received_at)}{s.received_by_name && ` by ${s.received_by_name}`}</span>}</dd></div>
      </dl>
      {['received', 'reconciliation_required', 'completed'].includes(s.status) && (
        <ul className="mt-3 space-y-1 text-sm">
          {s.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2">
              <span>{i.name}</span>
              {i.reconciliation === 'matches' && <Badge tone="green">Matches approved scan</Badge>}
              {i.reconciliation === 'mismatch' && <Badge tone="red">Does not match</Badge>}
              {i.reconciliation === 'pending' && <Badge>Not reconciled</Badge>}
              {i.reconciliation_note && <span className="text-xs text-slate-600">{i.reconciliation_note}</span>}
            </li>))}
        </ul>
      )}
      {s.cancelled_reason && <p className="mt-2 text-sm text-slate-600">Cancelled: {s.cancelled_reason}</p>}
      {canManage && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
          {['instructions_issued', 'dispatched', 'in_transit'].includes(s.status) && (
            <DispatchForm studentId={studentId} shipmentId={s.id} company={s.courier_company} tracking={s.tracking_number} />)}
          <ShipmentStatusButtons studentId={studentId} shipmentId={s.id} status={s.status} />
          {['received', 'reconciliation_required'].includes(s.status) && <ReconcileForm studentId={studentId} shipmentId={s.id} items={s.items} />}
        </div>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-600">History ({s.events.length})</summary>
        <ul className="mt-2 space-y-1">
          {s.events.map((e) => (
            <li key={e.id} className="text-xs text-slate-600">{fmtDateTime(e.created_at)} · {e.actor ?? (e.actor_type === 'student' ? 'Student (portal)' : 'System')} · {e.detail}</li>))}
        </ul>
      </details>
    </section>
  )
}
