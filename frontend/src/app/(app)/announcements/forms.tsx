'use client'

import { publishAnnouncementAction, withdrawAnnouncementAction } from '@/app/actions/staff-notifications'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

export function PublishAnnouncementForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  return (
    <ActionForm action={publishAnnouncementAction} resetOnSuccess className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {(s) => (<>
        <div><label className="label" htmlFor="an-org">Company</label><select className="input" id="an-org" name="orgId">{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <div><label className="label" htmlFor="an-sev">Level</label><select className="input" id="an-sev" name="severity"><option value="info">Normal</option><option value="warning">Important</option><option value="critical">Critical</option></select></div>
        <div className="md:col-span-2"><label className="label" htmlFor="an-title">Title</label><input className="input" id="an-title" name="title" required maxLength={150} /><FieldError state={s} name="title" /></div>
        <div className="md:col-span-2"><label className="label" htmlFor="an-body">Message</label><textarea className="input" id="an-body" name="body" rows={4} required maxLength={4000} /><FieldError state={s} name="body" /></div>
        <div className="md:col-span-2"><SubmitButton>Publish to all staff</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}

export function WithdrawAnnouncementButton({ id }: { id: string }) {
  return <ActionForm action={withdrawAnnouncementAction.bind(null, id)} className="inline"><ConfirmSubmit className="btn-secondary btn-sm" confirmText="Withdraw this announcement?">Withdraw</ConfirmSubmit></ActionForm>
}
