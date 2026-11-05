'use client'

import { useState } from 'react'
import { cancelLeaveAction, decideAttendanceAction, requestCorrectionAction, requestLeaveAction, setAttendanceStatusAction } from '@/app/actions/attendance'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

type Org = { id: string; name: string }
const OrgField = ({ orgs, id }: { orgs: Org[]; id: string }) => orgs.length > 1
  ? <div><label className="label" htmlFor={id}>Company</label><select id={id} name="orgId" className="input">{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
  : <input type="hidden" name="orgId" value={orgs[0]?.id ?? ''} />

export function CorrectionForm({ orgs }: { orgs: Org[] }) {
  return (
    <ActionForm action={requestCorrectionAction} resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {(s) => (<>
        <OrgField orgs={orgs} id="cr-org" />
        <div><label className="label" htmlFor="cr-date">Date</label><input className="input" id="cr-date" name="date" type="date" required /><FieldError state={s} name="date" /></div>
        <div><label className="label" htmlFor="cr-in">Correct check-in</label><input className="input" id="cr-in" name="checkIn" type="time" /><FieldError state={s} name="checkIn" /></div>
        <div><label className="label" htmlFor="cr-out">Correct check-out</label><input className="input" id="cr-out" name="checkOut" type="time" /></div>
        <div className="sm:col-span-3"><label className="label" htmlFor="cr-reason">Reason</label><input className="input" id="cr-reason" name="reason" required maxLength={1000} /><FieldError state={s} name="reason" /></div>
        <div className="sm:col-span-3"><SubmitButton className="btn-secondary btn-sm">Request correction</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}

export function LeaveForm({ orgs, leaveTypes }: { orgs: Org[]; leaveTypes: string[] }) {
  const [kind, setKind] = useState('leave')
  return (
    <ActionForm action={requestLeaveAction} resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {(s) => (<>
        <OrgField orgs={orgs} id="lv-org" />
        <div><label className="label" htmlFor="lv-kind">Request</label><select className="input" id="lv-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="leave">Leave</option><option value="field_duty">Field duty</option><option value="official_visit">Official visit</option></select></div>
        {kind === 'leave' && <div><label className="label" htmlFor="lv-type">Leave type</label><select className="input" id="lv-type" name="leaveType">{leaveTypes.map((t) => <option key={t}>{t}</option>)}</select></div>}
        <div><label className="label" htmlFor="lv-from">From</label><input className="input" id="lv-from" name="from" type="date" required /><FieldError state={s} name="from" /></div>
        <div><label className="label" htmlFor="lv-to">To</label><input className="input" id="lv-to" name="to" type="date" required /><FieldError state={s} name="to" /></div>
        <div className="sm:col-span-3"><label className="label" htmlFor="lv-reason">Reason</label><input className="input" id="lv-reason" name="reason" required maxLength={1000} /><FieldError state={s} name="reason" /></div>
        <div className="sm:col-span-3"><SubmitButton className="btn-secondary btn-sm">Send request</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}

export function CancelLeaveButton({ id }: { id: string }) {
  return <ActionForm action={cancelLeaveAction.bind(null, id)} className="inline"><ConfirmSubmit className="btn-ghost btn-sm" confirmText="Cancel this request?">Cancel</ConfirmSubmit></ActionForm>
}

/** Approve or refuse. A refusal needs a reason; the database enforces it too. */
export function DecisionForm({ kind, id, approve, refuse }: { kind: 'review' | 'correction' | 'leave'; id: string; approve: { value: string; label: string }; refuse: { value: string; label: string } }) {
  return (
    <ActionForm action={decideAttendanceAction.bind(null, kind, id)} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`note-${id}`}>Note</label>
      <input className="input max-w-56" id={`note-${id}`} name="note" placeholder="Note (required to refuse)" maxLength={500} />
      <SubmitButton name="decision" value={approve.value} className="btn-primary btn-sm">{approve.label}</SubmitButton>
      <SubmitButton name="decision" value={refuse.value} className="btn-secondary btn-sm">{refuse.label}</SubmitButton>
    </ActionForm>
  )
}

export function SetStatusForm({ people, orgs }: { people: { user_id: string; full_name: string; org_id: string }[]; orgs: Org[] }) {
  const [org, setOrg] = useState(orgs[0]?.id ?? '')
  return (
    <ActionForm action={setAttendanceStatusAction} className="grid grid-cols-1 gap-3 md:grid-cols-5" resetOnSuccess>
      {(<>
        <div><label className="label" htmlFor="ss-org">Company</label><select id="ss-org" name="orgId" className="input" value={org} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <div><label className="label" htmlFor="ss-user">Person</label><select id="ss-user" name="userId" className="input">{people.filter((p) => p.org_id === org).map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select></div>
        <div><label className="label" htmlFor="ss-date">Date</label><input id="ss-date" name="date" type="date" className="input" required /></div>
        <div><label className="label" htmlFor="ss-status">Status</label><select id="ss-status" name="status" className="input">{['present', 'late', 'half_day', 'leave', 'field_duty', 'official_visit', 'absent'].map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select></div>
        <div><label className="label" htmlFor="ss-note">Reason</label><input id="ss-note" name="note" className="input" required maxLength={500} /></div>
        <div className="md:col-span-5"><SubmitButton className="btn-secondary btn-sm">Record status</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}
