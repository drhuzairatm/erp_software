'use client'

import { closeRequestAction, createRequestAction, decideRequestAction, placeHoldAction, releaseHoldAction, setDelegateAction, setRetentionAction } from '@/app/actions/chat-governance'
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/components/forms'

type Person = { id: string; full_name: string }
const PersonOptions = ({ people }: { people: Person[] }) => <>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</>

export function RetentionForm({ orgId, v }: { orgId: string; v: { retention_days: number | null; archive_retention_days: number | null; purge_enabled: boolean; approval_reference: string | null } | null }) {
  return (
    <ActionForm action={setRetentionAction.bind(null, orgId)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div><label className="label" htmlFor="ret-days">Keep messages visible for (days)</label><input className="input" id="ret-days" name="retentionDays" inputMode="numeric" defaultValue={v?.retention_days ?? ''} /></div>
      <div><label className="label" htmlFor="ret-arch">Keep the archive for (days; empty keeps it)</label><input className="input" id="ret-arch" name="archiveDays" inputMode="numeric" defaultValue={v?.archive_retention_days ?? ''} /></div>
      <div className="md:col-span-2"><label className="label" htmlFor="ret-ref">Reference of the approved policy</label><input className="input" id="ret-ref" name="reference" maxLength={300} defaultValue={v?.approval_reference ?? ''} /></div>
      <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="purge" defaultChecked={v?.purge_enabled} />Apply this policy automatically</label>
      <div className="md:col-span-2"><SubmitButton className="btn-secondary btn-sm">Save policy</SubmitButton></div>
    </ActionForm>
  )
}

export function DelegateForm({ orgId, people, capabilities }: { orgId: string; people: Person[]; capabilities: { value: string; label: string }[] }) {
  return (
    <ActionForm action={setDelegateAction.bind(null, orgId)} className="grid grid-cols-1 gap-3 md:grid-cols-3" resetOnSuccess>
      <div><label className="label" htmlFor="del-user">Person</label><select className="input" id="del-user" name="user" required defaultValue=""><option value="" disabled>Choose…</option><PersonOptions people={people} /></select></div>
      <div><label className="label" htmlFor="del-cap">Responsibility</label><select className="input" id="del-cap" name="capability">{capabilities.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
      <div><label className="label" htmlFor="del-reason">Reason</label><input className="input" id="del-reason" name="reason" required maxLength={500} /></div>
      <div className="md:col-span-3"><SubmitButton className="btn-secondary btn-sm">Name this authority</SubmitButton></div>
    </ActionForm>
  )
}

export function RevokeDelegate({ orgId, user, capability }: { orgId: string; user: string; capability: string }) {
  return (
    <ActionForm action={setDelegateAction.bind(null, orgId)} className="inline">
      <input type="hidden" name="user" value={user} /><input type="hidden" name="capability" value={capability} /><input type="hidden" name="on" value="off" />
      <ConfirmSubmit className="btn-ghost btn-sm" confirmText="Remove this authority?">Remove</ConfirmSubmit>
    </ActionForm>
  )
}

export function HoldForm({ orgId, people, groups }: { orgId: string; people: Person[]; groups: { id: string; name: string }[] }) {
  return (
    <ActionForm action={placeHoldAction.bind(null, orgId)} className="grid grid-cols-1 gap-3 md:grid-cols-2" resetOnSuccess>
      <div><label className="label" htmlFor="hold-ref">Case reference</label><input className="input" id="hold-ref" name="reference" required maxLength={120} /></div>
      <div><label className="label" htmlFor="hold-user">Person (empty with no group: the whole company)</label><select className="input" id="hold-user" name="user" defaultValue=""><option value="">Not a specific person</option><PersonOptions people={people} /></select></div>
      <div><label className="label" htmlFor="hold-group">Group</label><select className="input" id="hold-group" name="group" defaultValue=""><option value="">Not a specific group</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
      <div className="md:col-span-2"><label className="label" htmlFor="hold-reason">Reason</label><textarea className="input" id="hold-reason" name="reason" rows={2} required maxLength={2000} /></div>
      <div className="md:col-span-2"><SubmitButton className="btn-secondary btn-sm">Place legal hold</SubmitButton></div>
    </ActionForm>
  )
}

export function ReleaseHold({ id }: { id: string }) {
  return (
    <ActionForm action={releaseHoldAction.bind(null, id)} className="mt-2 flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1"><label className="sr-only" htmlFor={`rel-${id}`}>Reason for release</label><input className="input" id={`rel-${id}`} name="reason" placeholder="Reason for release" required maxLength={500} /></div>
      <ConfirmSubmit className="btn-secondary btn-sm" confirmText="Release this legal hold?">Release</ConfirmSubmit>
    </ActionForm>
  )
}

export function RequestForm({ orgId, people, readers, groups }: { orgId: string; people: Person[]; readers: Person[]; groups: { id: string; name: string }[] }) {
  return (
    <ActionForm action={createRequestAction.bind(null, orgId)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div><label className="label" htmlFor="rq-ref">Case reference</label><input className="input" id="rq-ref" name="reference" required maxLength={120} /></div>
      <div><label className="label" htmlFor="rq-reader">Who will read</label><select className="input" id="rq-reader" name="reader" required defaultValue=""><option value="" disabled>Choose…</option><PersonOptions people={readers} /></select></div>
      <div><label className="label" htmlFor="rq-user">Person under review</label><select className="input" id="rq-user" name="user" defaultValue=""><option value="">Choose…</option><PersonOptions people={people} /></select></div>
      <div><label className="label" htmlFor="rq-user2">Only their direct chat with</label><select className="input" id="rq-user2" name="user2" defaultValue=""><option value="">All messages they sent</option><PersonOptions people={people} /></select></div>
      <div><label className="label" htmlFor="rq-group">Or a group</label><select className="input" id="rq-group" name="group" defaultValue=""><option value="">Not a group</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
      <div className="grid grid-cols-2 gap-2"><div><label className="label" htmlFor="rq-from">From</label><input className="input" id="rq-from" name="from" type="date" /></div><div><label className="label" htmlFor="rq-to">To</label><input className="input" id="rq-to" name="to" type="date" /></div></div>
      <div className="md:col-span-2"><label className="label" htmlFor="rq-reason">Reason</label><textarea className="input" id="rq-reason" name="reason" rows={3} required maxLength={2000} /></div>
      <div className="md:col-span-2"><SubmitButton>Submit request</SubmitButton></div>
    </ActionForm>
  )
}

export function DecideForm({ id }: { id: string }) {
  return (
    <ActionForm action={decideRequestAction.bind(null, id)} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="md:col-span-2"><label className="label" htmlFor="dc-note">Reason for the decision</label><input className="input" id="dc-note" name="note" required maxLength={2000} /></div>
      <div><label className="label" htmlFor="dc-days">Access period if approved (1 to 30 days)</label><input className="input" id="dc-days" name="days" inputMode="numeric" /></div>
      <div className="flex flex-wrap gap-2 md:col-span-3"><SubmitButton name="decision" value="approve">Approve</SubmitButton><SubmitButton name="decision" value="reject" className="btn-secondary">Reject</SubmitButton></div>
    </ActionForm>
  )
}

export function CloseRequest({ id }: { id: string }) {
  return <ActionForm action={closeRequestAction.bind(null, id)} className="inline"><ConfirmSubmit className="btn-secondary btn-sm" confirmText="Close this request? Access ends now.">Close request</ConfirmSubmit></ActionForm>
}
