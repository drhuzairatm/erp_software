'use client'

import { useState } from 'react'
import { actionToTaskAction, addActionPointAction, addDecisionAction, cancelMeetingAction, coreTeamAction, createMeetingAction, saveMinutesAction, updateMeetingAction } from '@/app/actions/meetings'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

type Person = { id: string; full_name: string; org_id?: string }
type Defaults = { title?: string; meeting_type?: string; date?: string; time?: string; location?: string | null; agenda?: string | null; note_taker_id?: string | null; attendees?: string[] }

function MeetingFields({ people, v, s }: { people: Person[]; v: Defaults; s: Parameters<typeof FieldError>[0]['state'] }) {
  return (<>
    <div className="md:col-span-2"><label className="label" htmlFor="m-title">Title *</label><input className="input" id="m-title" name="title" defaultValue={v.title} required maxLength={200} /><FieldError state={s} name="title" /></div>
    <div><label className="label" htmlFor="m-type">Type</label><select className="input" id="m-type" name="meetingType" defaultValue={v.meeting_type ?? 'daily_core'}><option value="daily_core">Daily core meeting</option><option value="other">Other meeting</option></select></div>
    <div><label className="label" htmlFor="m-date">Date *</label><input className="input" id="m-date" name="date" type="date" defaultValue={v.date} required /><FieldError state={s} name="date" /></div>
    <div><label className="label" htmlFor="m-time">Time *</label><input className="input" id="m-time" name="time" type="time" defaultValue={v.time} required /></div>
    <div><label className="label" htmlFor="m-loc">Location</label><input className="input" id="m-loc" name="location" defaultValue={v.location ?? ''} maxLength={200} /></div>
    <div><label className="label" htmlFor="m-notes">Note taker</label><select className="input" id="m-notes" name="noteTaker" defaultValue={v.note_taker_id ?? ''}><option value="">None</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
    <div className="md:col-span-2"><label className="label" htmlFor="m-agenda">Agenda</label><textarea className="input" id="m-agenda" name="agenda" rows={3} defaultValue={v.agenda ?? ''} maxLength={8000} /></div>
    <fieldset className="md:col-span-2"><legend className="label">Attendees</legend>
      <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 text-sm sm:grid-cols-2">{people.map((p) => <label key={p.id} className="flex items-center gap-2"><input type="checkbox" name="attendees" value={p.id} defaultChecked={v.attendees?.includes(p.id)} />{p.full_name}</label>)}</div></fieldset>
  </>)
}

export function NewMeetingForm({ orgs, staff }: { orgs: { id: string; name: string }[]; staff: Required<Person>[] }) {
  const [org, setOrg] = useState(orgs[0]?.id ?? '')
  return (
    <ActionForm action={createMeetingAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {(s) => (<>
        <div className="md:col-span-2"><label className="label" htmlFor="m-org">Company</label><select className="input" id="m-org" name="orgId" value={org} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <MeetingFields key={org} people={staff.filter((p) => p.org_id === org)} v={{}} s={s} />
        <div className="md:col-span-2"><SubmitButton>Create meeting</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}

export function EditMeetingForm({ id, people, v }: { id: string; people: Person[]; v: Defaults }) {
  return (
    <ActionForm action={updateMeetingAction.bind(null, id)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {(s) => (<><MeetingFields people={people} v={v} s={s} /><div className="md:col-span-2"><SubmitButton className="btn-secondary">Save meeting</SubmitButton></div></>)}
    </ActionForm>
  )
}

export function CancelMeetingButton({ id }: { id: string }) {
  return <ActionForm action={cancelMeetingAction.bind(null, id)} className="inline"><ConfirmSubmit className="btn-secondary btn-sm" confirmText="Cancel this meeting? It stays on record.">Cancel meeting</ConfirmSubmit></ActionForm>
}

export function MinutesForm({ id, notes, hasMinutes }: { id: string; notes?: string; hasMinutes: boolean }) {
  return (
    <ActionForm action={saveMinutesAction.bind(null, id)} className="space-y-2">
      <label className="label" htmlFor="min-notes">Discussion notes</label>
      <textarea className="input" id="min-notes" name="notes" rows={8} defaultValue={notes} required maxLength={50000} />
      {hasMinutes && <><label className="label" htmlFor="min-reason">Reason for this change *</label><input className="input" id="min-reason" name="reason" required maxLength={500} /></>}
      <SubmitButton>Save minutes</SubmitButton>
    </ActionForm>
  )
}

export function DecisionForm({ id }: { id: string }) {
  return (
    <ActionForm action={addDecisionAction.bind(null, id)} className="space-y-2" resetOnSuccess>
      {(s) => (<><label className="label" htmlFor="dec-body">New decision</label><textarea className="input" id="dec-body" name="body" rows={2} required maxLength={4000} /><FieldError state={s} name="body" /><SubmitButton className="btn-secondary btn-sm">Add decision</SubmitButton></>)}
    </ActionForm>
  )
}

export function ActionPointForm({ id, people, decisions }: { id: string; people: Person[]; decisions: { id: string; body: string }[] }) {
  return (
    <ActionForm action={addActionPointAction.bind(null, id)} className="grid grid-cols-1 gap-3 md:grid-cols-3" resetOnSuccess>
      {(s) => (<>
        <div className="md:col-span-3"><label className="label" htmlFor="act-desc">Action point</label><input className="input" id="act-desc" name="description" required maxLength={2000} /><FieldError state={s} name="description" /></div>
        <div><label className="label" htmlFor="act-resp">Responsible</label><select className="input" id="act-resp" name="responsible"><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
        <div><label className="label" htmlFor="act-date">Deadline date</label><input className="input" id="act-date" name="date" type="date" /></div>
        <div><label className="label" htmlFor="act-time">Deadline time</label><input className="input" id="act-time" name="time" type="time" /></div>
        <div><label className="label" htmlFor="act-pri">Priority</label><select className="input" id="act-pri" name="priority" defaultValue="normal"><option value="urgent">Critical</option><option value="high">High</option><option value="normal">Medium</option><option value="low">Low</option></select></div>
        {decisions.length > 0 && <div className="md:col-span-2"><label className="label" htmlFor="act-dec">From decision</label><select className="input" id="act-dec" name="decisionId"><option value="">None</option>{decisions.map((d) => <option key={d.id} value={d.id}>{d.body.slice(0, 80)}</option>)}</select></div>}
        <div className="md:col-span-3"><SubmitButton className="btn-secondary btn-sm">Add action point</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}

export function ToTaskButton({ meetingId, actionId }: { meetingId: string; actionId: string }) {
  return <ActionForm action={actionToTaskAction.bind(null, meetingId, actionId)} className="inline"><SubmitButton className="btn-secondary btn-sm" pendingText="Creating…">Create task</SubmitButton></ActionForm>
}

export function CoreTeamToggle({ orgId, userId, member }: { orgId: string; userId: string; member: boolean }) {
  return <ActionForm action={coreTeamAction.bind(null, orgId, userId, !member)} className="inline"><SubmitButton className={member ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}>{member ? 'Remove' : 'Add'}</SubmitButton></ActionForm>
}
