'use client'

import { assignTicketAction, replyTicketAction, setTicketStatusAction } from '@/app/actions/tickets'
import { ActionForm, SubmitButton } from '@/components/forms'

export function ReplyForm({ id }: { id: string }) {
  return (
    <ActionForm action={replyTicketAction.bind(null, id)} resetOnSuccess className="space-y-3">
      <div><label className="label" htmlFor="t-body">Reply to the student *</label><textarea className="input" id="t-body" name="body" rows={4} required maxLength={4000} /><p className="hint">The student reads this. Do not include other students&apos; details or internal notes.</p></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="t-files">Attachments</label><input className="input" id="t-files" name="files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" /><p className="hint">Up to 3 files, 10 MB together.</p></div>
        <div><label className="label" htmlFor="t-next">After sending</label><select className="input" id="t-next" name="next" defaultValue="waiting_for_student"><option value="waiting_for_student">Waiting for student</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select></div>
      </div>
      <SubmitButton pendingText="Sending…">Send reply</SubmitButton>
    </ActionForm>
  )
}

export function StatusForm({ id, current }: { id: string; current: string }) {
  return (
    <ActionForm action={setTicketStatusAction.bind(null, id)} className="space-y-2">
      <div><label className="label" htmlFor="st-status">Status</label><select className="input" id="st-status" name="status" defaultValue={current}><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting_for_student">Waiting for student</option><option value="resolved">Resolved</option><option value="closed">Closed (final)</option></select></div>
      <div><label className="label" htmlFor="st-note">Internal note</label><input className="input" id="st-note" name="note" maxLength={1000} /><p className="hint">Staff only. Never shown to the student.</p></div>
      <SubmitButton className="btn-secondary">Save status</SubmitButton>
    </ActionForm>
  )
}

export function AssignTicketForm({ id, staff, current }: { id: string; staff: { id: string; full_name: string }[]; current: string | null }) {
  return (
    <ActionForm action={assignTicketAction.bind(null, id)} className="space-y-2">
      <div><label className="label" htmlFor="as-user">{current ? 'Reassign to' : 'Assign to'}</label><select className="input" id="as-user" name="user" defaultValue={current ?? ''} required><option value="">Choose</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
      {current && <div><label className="label" htmlFor="as-why">Reason for reassigning</label><input className="input" id="as-why" name="reason" maxLength={500} /></div>}
      <SubmitButton className="btn-secondary">Save assignment</SubmitButton>
    </ActionForm>
  )
}
