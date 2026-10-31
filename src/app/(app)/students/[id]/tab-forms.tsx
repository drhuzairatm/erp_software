'use client'

import { useState } from 'react'
import { addChecklistItemAction, custodyAction, documentDetailsAction, uploadAction } from '@/app/actions/documents'
import { recordPaymentAction, reversePaymentAction, verifyPaymentAction } from '@/app/actions/payments'
import { createTaskAction } from '@/app/actions/tasks'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

type Opt = { value: string; label: string }

// ---------------------------------------------------------------- documents
export function UploadForm({ studentId, documentId }: { studentId: string; documentId: string }) {
  return (
    <ActionForm action={uploadAction.bind(null, studentId, documentId)} className="flex flex-wrap items-center gap-2" resetOnSuccess>
      <label className="sr-only" htmlFor={`file-${documentId}`}>File</label>
      <input id={`file-${documentId}`} type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/webp"
        className="block max-w-64 text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs" />
      <SubmitButton className="btn-secondary btn-sm" pendingText="Uploading…">Upload</SubmitButton>
    </ActionForm>
  )
}

export function CustodyForm({ studentId, documentId, current }: { studentId: string; documentId: string; current: string | null }) {
  return (
    <ActionForm action={custodyAction.bind(null, studentId, documentId)} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
      <div>
        <label className="label text-xs" htmlFor={`loc-${documentId}`}>Original is now</label>
        <select id={`loc-${documentId}`} name="location" className="input py-1 text-xs" defaultValue={current ?? ''} required>
          <option value="" disabled>Choose…</option>
          <option value="with_student">With the student</option><option value="with_staff">With internal staff</option>
          <option value="with_provider">With attestation / translation provider</option><option value="at_embassy">At the embassy</option>
          <option value="at_university">At the university</option><option value="returned_to_student">Returned to the student</option>
        </select>
      </div>
      <div><label className="label text-xs" htmlFor={`ref-${documentId}`}>Tracking / reference no.</label><input id={`ref-${documentId}`} name="ref" className="input py-1 text-xs" maxLength={100} /></div>
      <div><label className="label text-xs" htmlFor={`note-${documentId}`}>Note</label><input id={`note-${documentId}`} name="note" className="input py-1 text-xs" maxLength={300} /></div>
      <div className="flex items-end"><SubmitButton className="btn-secondary btn-sm">Record location</SubmitButton></div>
    </ActionForm>
  )
}

export function DocumentDetailsForm({ studentId, documentId, expiry, notes, issuingCountryId, countries }: {
  studentId: string; documentId: string; expiry: string | null; notes: string | null; issuingCountryId: string | null; countries: Opt[]
}) {
  return (
    <ActionForm action={documentDetailsAction.bind(null, studentId, documentId)} className="grid grid-cols-1 gap-2 sm:grid-cols-5">
      <div><label className="label text-xs" htmlFor={`ic-${documentId}`}>Certificate issuing country</label>
        <select id={`ic-${documentId}`} name="issuingCountryId" className="input py-1 text-xs" defaultValue={issuingCountryId ?? ''}>
          <option value="">—</option>{countries.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select></div>
      <div><label className="label text-xs" htmlFor={`exp-${documentId}`}>Expiry date</label><input id={`exp-${documentId}`} name="expiryDate" type="date" className="input py-1 text-xs" defaultValue={expiry ?? ''} /></div>
      <div className="sm:col-span-2"><label className="label text-xs" htmlFor={`dn-${documentId}`}>Internal note</label><input id={`dn-${documentId}`} name="notes" className="input py-1 text-xs" defaultValue={notes ?? ''} maxLength={2000} /></div>
      <div className="flex items-end"><SubmitButton className="btn-secondary btn-sm">Save</SubmitButton></div>
    </ActionForm>
  )
}

export function AddChecklistItemForm({ studentId, types }: { studentId: string; types: Opt[] }) {
  return (
    <ActionForm action={addChecklistItemAction.bind(null, studentId)} className="grid grid-cols-1 gap-2 sm:grid-cols-4" resetOnSuccess>
      <div><label className="label" htmlFor="documentTypeId">Document type</label>
        <select id="documentTypeId" name="documentTypeId" className="input" required>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
      <div><label className="label" htmlFor="label">Label (optional)</label><input id="label" name="label" className="input" maxLength={120} placeholder="e.g. Sponsor's passport" /></div>
      <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="required" value="yes" defaultChecked /> Required</label>
      <div className="flex items-end"><SubmitButton className="btn-secondary">Add to checklist</SubmitButton></div>
    </ActionForm>
  )
}

// ---------------------------------------------------------------- payments
export function PaymentForm({ studentId, orgs, categories, entities, today }: {
  studentId: string; orgs: Opt[]; categories: { id: string; org_id: string; name: string; kind: string }[]; entities: Opt[]; today: string
}) {
  const [org, setOrg] = useState(orgs[0]?.value ?? '')
  const [type, setType] = useState('charge')
  const cats = categories.filter((c) => c.org_id === org && (type !== 'disbursement' || c.kind === 'third_party'))
  return (
    <ActionForm action={recordPaymentAction.bind(null, studentId)} resetOnSuccess>
      {(s) => (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {orgs.length > 1 && (
            <div><label className="label" htmlFor="pay-org">Company ledger</label>
              <select id="pay-org" name="orgId" className="input" value={org} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
          )}
          {orgs.length === 1 && <input type="hidden" name="orgId" value={org} />}
          <div><label className="label" htmlFor="entryType">Entry type</label>
            <select id="entryType" name="entryType" className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="charge">Charge (amount due)</option><option value="receipt">Receipt (money received)</option>
              <option value="waiver">Waiver / discount</option><option value="refund">Refund to student</option>
              <option value="disbursement">Disbursement (paid to university / provider)</option>
            </select></div>
          <div><label className="label" htmlFor="feeCategoryId">Category</label>
            <select id="feeCategoryId" name="feeCategoryId" className="input" required key={org + type}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}{c.kind === 'third_party' ? ' (third-party)' : ''}</option>)}
            </select><FieldError state={s} name="feeCategoryId" /></div>
          <div><label className="label" htmlFor="amount">Amount</label><input id="amount" name="amount" inputMode="decimal" className="input" required placeholder="15000" aria-invalid={!!s.fieldErrors?.amount} /><FieldError state={s} name="amount" /></div>
          <div><label className="label" htmlFor="entryDate">Date</label><input id="entryDate" name="entryDate" type="date" className="input" required defaultValue={today} /></div>
          {type !== 'charge' && type !== 'waiver' && (
            <>
              <div><label className="label" htmlFor="method">Method</label>
                <select id="method" name="method" className="input" defaultValue="">
                  <option value="">—</option><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option>
                  <option value="card">Card</option><option value="cheque">Cheque</option><option value="other">Other</option>
                </select><FieldError state={s} name="method" /></div>
              <div><label className="label" htmlFor="referenceNo">Transaction / reference no.</label><input id="referenceNo" name="referenceNo" className="input" maxLength={100} /></div>
              <div><label className="label" htmlFor="receiptRef">Receipt reference</label><input id="receiptRef" name="receiptRef" className="input" maxLength={100} /></div>
            </>
          )}
          {type === 'disbursement' && <div><label className="label" htmlFor="payee">Paid to</label><input id="payee" name="payee" className="input" maxLength={200} required /><FieldError state={s} name="payee" /></div>}
          <div><label className="label" htmlFor="recipientEntityId">Recipient entity</label>
            <select id="recipientEntityId" name="recipientEntityId" className="input" defaultValue=""><option value="">Not specified</option>{entities.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}</select></div>
          <div className="md:col-span-2"><label className="label" htmlFor="pay-notes">Notes</label><input id="pay-notes" name="notes" className="input" maxLength={2000} /></div>
          <div className="flex items-end md:col-span-4"><SubmitButton>Record entry</SubmitButton></div>
        </div>
      )}
    </ActionForm>
  )
}

export function VerifyForm({ entryId, back }: { entryId: string; back: string }) {
  const [reject, setReject] = useState(false)
  return (
    <ActionForm action={verifyPaymentAction.bind(null, entryId, back)} className="flex flex-wrap items-center gap-1">
      {reject ? (
        <>
          <input type="hidden" name="decision" value="rejected" />
          <label className="sr-only" htmlFor={`vnote-${entryId}`}>Rejection note</label>
          <input id={`vnote-${entryId}`} name="note" className="input py-1 text-xs" placeholder="Why? (required)" required />
          <SubmitButton className="btn-danger btn-sm">Reject</SubmitButton>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setReject(false)}>Cancel</button>
        </>
      ) : (
        <>
          <input type="hidden" name="decision" value="verified" />
          <SubmitButton className="btn-secondary btn-sm" pendingText="…">Verify</SubmitButton>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setReject(true)}>Reject…</button>
        </>
      )}
    </ActionForm>
  )
}

export function ReverseForm({ entryId, back }: { entryId: string; back: string }) {
  return (
    <ActionForm action={reversePaymentAction.bind(null, entryId, back)} className="flex flex-wrap items-center gap-1">
      <label className="sr-only" htmlFor={`rev-${entryId}`}>Reversal reason</label>
      <input id={`rev-${entryId}`} name="reason" className="input py-1 text-xs" placeholder="Reason for reversal" required maxLength={500} />
      <ConfirmSubmit className="btn-secondary btn-sm" confirmText="Record a reversal?">Reverse</ConfirmSubmit>
    </ActionForm>
  )
}

// ---------------------------------------------------------------- tasks
export function QuickTaskForm({ studentId, orgs, staff, canAssignOrgs, me }: {
  studentId: string; orgs: Opt[]; staff: { id: string; full_name: string; org_id: string }[]; canAssignOrgs: string[]; me: string
}) {
  const [org, setOrg] = useState(orgs[0]?.value ?? '')
  const assignable = canAssignOrgs.includes(org) ? staff.filter((s) => s.org_id === org) : staff.filter((s) => s.id === me)
  return (
    <ActionForm action={createTaskAction} resetOnSuccess>
      {(s) => (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="returnTo" value={`/students/${studentId}`} />
          <div className="md:col-span-2"><label className="label" htmlFor="title">Task</label><input id="title" name="title" className="input" required maxLength={200} /><FieldError state={s} name="title" /></div>
          {orgs.length > 1 ? (
            <div><label className="label" htmlFor="task-org">Company</label>
              <select id="task-org" name="orgId" className="input" value={org} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
          ) : <input type="hidden" name="orgId" value={org} />}
          <div><label className="label" htmlFor="taskType">Type</label>
            <select id="taskType" name="taskType" className="input">
              {['general', 'followup', 'documentation', 'attestation', 'apostille', 'translation', 'university_application', 'visa', 'finance', 'travel'].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select></div>
          <div><label className="label" htmlFor="assignedTo">Assign to</label>
            <select id="assignedTo" name="assignedTo" className="input" defaultValue={me} key={org}>
              <option value="">Unassigned</option>{assignable.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select></div>
          <div><label className="label" htmlFor="priority">Priority</label>
            <select id="priority" name="priority" className="input" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
          <div><label className="label" htmlFor="dueDate">Due date</label><input id="dueDate" name="dueDate" type="date" className="input" /></div>
          <div className="flex items-end"><SubmitButton>Create task</SubmitButton></div>
        </div>
      )}
    </ActionForm>
  )
}
