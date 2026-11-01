'use client'

import { useState } from 'react'
import { issueCourierAction, reconcileShipmentAction, recordDispatchAction, shipmentStatusAction } from '@/app/actions/courier'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'

type Doc = { id: string; name: string; status: string; approved: boolean }

export function IssueInstructionsForm({ studentId, addresses, documents, canException }: {
  studentId: string; addresses: { id: string; label: string; recipient: string; address: string }[]; documents: Doc[]; canException: boolean
}) {
  const [chosen, setChosen] = useState<string[]>([])
  const unapproved = documents.filter((d) => chosen.includes(d.id) && !d.approved).length
  const selectable = documents.filter((d) => d.approved || canException)
  return (
    <ActionForm action={issueCourierAction.bind(null, studentId)} className="space-y-4" resetOnSuccess onSuccess={() => setChosen([])}>
      {(s) => (
        <>
          <div>
            <label className="label" htmlFor="cr-address">Delivery address *</label>
            <select className="input" id="cr-address" name="addressId" required defaultValue={addresses.length === 1 ? addresses[0].id : ''}>
              <option value="">Choose…</option>
              {addresses.map((a) => <option key={a.id} value={a.id}>{a.label} – {a.recipient}</option>)}
            </select>
            <FieldError state={s} name="addressId" />
          </div>
          <fieldset>
            <legend className="label">Originals to be sent *</legend>
            {selectable.length === 0 ? <p className="text-sm text-slate-500">No document has an approved scan yet.</p> : (
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {selectable.map((d) => (
                  <li key={d.id}>
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                      <input type="checkbox" name="documents" value={d.id} checked={chosen.includes(d.id)}
                        onChange={(e) => setChosen((c) => e.target.checked ? [...c, d.id] : c.filter((x) => x !== d.id))} />
                      <span className="flex-1">{d.name}</span>
                      {d.approved ? <span className="text-xs font-medium text-emerald-700">Scan approved</span>
                        : <span className="text-xs font-medium text-amber-700">Scan not approved</span>}
                    </label>
                  </li>))}
              </ul>
            )}
            <FieldError state={s} name="documents" />
          </fieldset>
          {unapproved > 0 && (
            <div>
              <label className="label" htmlFor="cr-exception">Exception reason * (instructions before scan approval are recorded in the audit log)</label>
              <input className="input" id="cr-exception" name="exception" required maxLength={500} />
            </div>
          )}
          <SubmitButton>Issue courier instructions</SubmitButton>
          <p className="hint">The student sees the delivery address in the portal only after this step.</p>
        </>
      )}
    </ActionForm>
  )
}

export function DispatchForm({ studentId, shipmentId, company, tracking }: { studentId: string; shipmentId: string; company: string | null; tracking: string | null }) {
  return (
    <ActionForm action={recordDispatchAction.bind(null, studentId, shipmentId)} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
      {(s) => (
        <>
          <div><label className="label text-xs" htmlFor={`cc-${shipmentId}`}>Courier company *</label>
            <input className="input py-1.5" id={`cc-${shipmentId}`} name="courierCompany" defaultValue={company ?? ''} maxLength={120} required /><FieldError state={s} name="courierCompany" /></div>
          <div><label className="label text-xs" htmlFor={`tn-${shipmentId}`}>Tracking number *</label>
            <input className="input py-1.5 font-mono" id={`tn-${shipmentId}`} name="trackingNumber" defaultValue={tracking ?? ''} maxLength={80} required /><FieldError state={s} name="trackingNumber" /></div>
          <div><label className="label text-xs" htmlFor={`dd-${shipmentId}`}>Dispatch date</label>
            <input className="input py-1.5" id={`dd-${shipmentId}`} name="dispatchDate" type="date" /></div>
          <div><label className="label text-xs" htmlFor={`ed-${shipmentId}`}>Expected delivery</label>
            <input className="input py-1.5" id={`ed-${shipmentId}`} name="expectedDelivery" type="date" /></div>
          <div className="sm:col-span-4"><SubmitButton className="btn-secondary btn-sm">Save courier details</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function ShipmentStatusButtons({ studentId, shipmentId, status }: { studentId: string; shipmentId: string; status: string }) {
  const [cancel, setCancel] = useState(false)
  return (
    <ActionForm action={shipmentStatusAction.bind(null, studentId, shipmentId)} className="flex flex-wrap items-end gap-2">
      {(s) => (
        <>
          {status === 'dispatched' && <SubmitButton name="status" value="in_transit" className="btn-secondary btn-sm">Mark in transit</SubmitButton>}
          {['dispatched', 'in_transit'].includes(status) && <SubmitButton name="status" value="received" className="btn-primary btn-sm">Confirm original received</SubmitButton>}
          {['instructions_issued', 'dispatched', 'in_transit'].includes(status) && !cancel && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setCancel(true)}>Cancel shipment…</button>)}
          {cancel && (
            <>
              <div><label className="label text-xs" htmlFor={`cn-${shipmentId}`}>Reason for cancelling *</label>
                <input className="input py-1.5" id={`cn-${shipmentId}`} name="note" required maxLength={500} /><FieldError state={s} name="note" /></div>
              <SubmitButton name="status" value="cancelled" className="btn-danger btn-sm">Cancel shipment</SubmitButton>
            </>
          )}
        </>
      )}
    </ActionForm>
  )
}

export function ReconcileForm({ studentId, shipmentId, items }: { studentId: string; shipmentId: string; items: { id: string; name: string; reconciliation: string; reconciliation_note: string | null }[] }) {
  const [res, setRes] = useState<Record<string, string>>(Object.fromEntries(items.map((i) => [i.id, i.reconciliation === 'pending' ? '' : i.reconciliation])))
  return (
    <ActionForm action={reconcileShipmentAction.bind(null, studentId, shipmentId)} className="space-y-3">
      {(s) => (
        <>
          <p className="text-sm font-medium">Reconcile each original against the approved scan</p>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium">{i.name}</p>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-1"><input type="radio" name={`result_${i.id}`} value="matches" required checked={res[i.id] === 'matches'}
                    onChange={() => setRes((r) => ({ ...r, [i.id]: 'matches' }))} /> Matches the approved scan</label>
                  <label className="flex items-center gap-1"><input type="radio" name={`result_${i.id}`} value="mismatch" checked={res[i.id] === 'mismatch'}
                    onChange={() => setRes((r) => ({ ...r, [i.id]: 'mismatch' }))} /> Does not match</label>
                </div>
                {res[i.id] === 'mismatch' && (
                  <div className="mt-2"><label className="label text-xs" htmlFor={`rn-${i.id}`}>What is different? *</label>
                    <input className="input py-1.5" id={`rn-${i.id}`} name={`note_${i.id}`} required maxLength={1000} defaultValue={i.reconciliation_note ?? ''} />
                    <FieldError state={s} name={`note_${i.id}`} /></div>
                )}
              </li>))}
          </ul>
          <SubmitButton className="btn-primary btn-sm">Save reconciliation</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}
