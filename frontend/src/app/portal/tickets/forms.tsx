'use client'

import { ActionForm, SubmitButton } from '@/components/forms'
import { createTicketAction, replyTicketAction } from './actions'

const CATEGORIES: [string, string][] = [['admission', 'Admission'], ['documents', 'Documents'], ['visa', 'Visa'], ['payments', 'Payments'], ['courier', 'Courier'], ['portal_account', 'Portal account'], ['other', 'Something else']]
const Files = ({ id }: { id: string }) => <div><label className="label" htmlFor={id}>Attachments</label><input className="input" id={id} name="files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" /><p className="hint">Up to 3 files, 10 MB together: PDF, JPEG, PNG or WebP.</p></div>

export function NewTicketForm() {
  return (
    <ActionForm action={createTicketAction} className="space-y-3">
      <div><label className="label" htmlFor="q-cat">Category *</label><select className="input" id="q-cat" name="category" required defaultValue=""><option value="">Choose</option>{CATEGORIES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
      <div><label className="label" htmlFor="q-subject">Subject *</label><input className="input" id="q-subject" name="subject" required minLength={3} maxLength={200} /></div>
      <div><label className="label" htmlFor="q-body">Your question *</label><textarea className="input" id="q-body" name="body" rows={4} required maxLength={4000} /></div>
      <Files id="q-files" />
      <SubmitButton pendingText="Sending…">Send question</SubmitButton>
    </ActionForm>
  )
}

export function StudentReplyForm({ id }: { id: string }) {
  return (
    <ActionForm action={replyTicketAction.bind(null, id)} resetOnSuccess className="space-y-3">
      <div><label className="label" htmlFor="r-body">Your reply *</label><textarea className="input" id="r-body" name="body" rows={3} required maxLength={4000} /></div>
      <Files id="r-files" />
      <SubmitButton pendingText="Sending…">Send reply</SubmitButton>
    </ActionForm>
  )
}
