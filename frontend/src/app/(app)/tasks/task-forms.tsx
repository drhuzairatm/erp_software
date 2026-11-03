'use client'

import { useState } from 'react'
import { commentAction, createTaskAction, updateTaskAction } from '@/app/actions/tasks'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'
import { DELAY_REASONS, PRIORITIES, TASK_STATUSES, TASK_TYPES } from '@/server/validation'

const lbl = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export function NewTaskForm({ orgs, staff, assignOrgs, me }: { orgs: { id: string; name: string }[]; staff: { id: string; full_name: string; org_id: string }[]; assignOrgs: string[]; me: string }) {
  const [org, setOrg] = useState(orgs[0]?.id ?? '')
  const [status, setStatus] = useState('not_started')
  const people = assignOrgs.includes(org) ? staff.filter((s) => s.org_id === org) : staff.filter((s) => s.id === me)
  return (
    <ActionForm action={createTaskAction}>
      {(s) => (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div><label className="label" htmlFor="orgId">Company</label>
            <select className="input" id="orgId" name="orgId" value={org} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div><label className="label" htmlFor="taskType">Type</label>
            <select className="input" id="taskType" name="taskType">{TASK_TYPES.map((t) => <option key={t} value={t}>{lbl(t)}</option>)}</select></div>
          <div className="md:col-span-2"><label className="label" htmlFor="title">Title *</label><input className="input" id="title" name="title" required maxLength={200} aria-invalid={!!s.fieldErrors?.title} /><FieldError state={s} name="title" /></div>
          <div className="md:col-span-2"><label className="label" htmlFor="description">Description</label><textarea className="input" id="description" name="description" rows={3} maxLength={4000} /></div>
          <div><label className="label" htmlFor="assignedTo">Assign to</label>
            <select className="input" id="assignedTo" name="assignedTo" defaultValue={me} key={org}><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
          <div><label className="label" htmlFor="priority">Priority</label>
            <select className="input" id="priority" name="priority" defaultValue="normal">{PRIORITIES.map((p) => <option key={p} value={p}>{lbl(p)}</option>)}</select></div>
          <div><label className="label" htmlFor="dueDate">Due date</label><input className="input" id="dueDate" name="dueDate" type="date" /></div>
          <div><label className="label" htmlFor="status">Status</label>
            <select className="input" id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value)}>{TASK_STATUSES.filter((x) => x !== 'completed' && x !== 'cancelled').map((x) => <option key={x} value={x}>{lbl(x)}</option>)}</select></div>
          {status === 'waiting_external' && (
            <div><label className="label" htmlFor="delayReason">Waiting on *</label>
              <select className="input" id="delayReason" name="delayReason" required>{DELAY_REASONS.filter((d) => d !== 'internal_staff').map((d) => <option key={d} value={d}>{lbl(d)}</option>)}</select>
              <FieldError state={s} name="delayReason" /></div>
          )}
          <div className="md:col-span-2"><SubmitButton>Create task</SubmitButton></div>
        </div>
      )}
    </ActionForm>
  )
}

export function UpdateTaskForm({ id, status, delayReason, delayNote, priority, dueDate, assignedTo, canReassign, staff }: {
  id: string; status: string; delayReason: string | null; delayNote: string | null; priority: string; dueDate: string | null
  assignedTo: string | null; canReassign: boolean; staff: { id: string; full_name: string }[]
}) {
  const [st, setSt] = useState(status)
  const [delay, setDelay] = useState(delayReason ?? '')
  return (
    <ActionForm action={updateTaskAction.bind(null, id)}>
      {(s) => (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div><label className="label" htmlFor="status">Status</label>
            <select className="input" id="status" name="status" value={st} onChange={(e) => setSt(e.target.value)}>{TASK_STATUSES.map((x) => <option key={x} value={x}>{lbl(x)}</option>)}</select></div>
          <div><label className="label" htmlFor="priority">Priority</label>
            <select className="input" id="priority" name="priority" defaultValue={priority}>{PRIORITIES.map((p) => <option key={p} value={p}>{lbl(p)}</option>)}</select></div>
          <div><label className="label" htmlFor="delayReason">Delay reason {st === 'waiting_external' && '*'}</label>
            <select className="input" id="delayReason" name="delayReason" value={delay} onChange={(e) => setDelay(e.target.value)} required={st === 'waiting_external'} aria-invalid={!!s.fieldErrors?.delayReason}>
              <option value="">None</option>{DELAY_REASONS.map((d) => <option key={d} value={d}>{lbl(d)}</option>)}
            </select><FieldError state={s} name="delayReason" /></div>
          <div><label className="label" htmlFor="delayNote">Delay note</label><input className="input" id="delayNote" name="delayNote" defaultValue={delayNote ?? ''} maxLength={1000} /></div>
          {canReassign && (
            <>
              <div><label className="label" htmlFor="assignedTo">Assigned to</label>
                <select className="input" id="assignedTo" name="assignedTo" defaultValue={assignedTo ?? ''}><option value="">Unassigned</option>{staff.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
              <div><label className="label" htmlFor="dueDate">Due date</label><input className="input" id="dueDate" name="dueDate" type="date" defaultValue={dueDate ?? ''} /></div>
            </>
          )}
          <div className="md:col-span-2"><SubmitButton>Save changes</SubmitButton></div>
        </div>
      )}
    </ActionForm>
  )
}

export function CommentForm({ id }: { id: string }) {
  return (
    <ActionForm action={commentAction.bind(null, id)} resetOnSuccess>
      <label className="label" htmlFor="body">Add a comment</label>
      <textarea className="input" id="body" name="body" rows={2} required maxLength={4000} />
      <SubmitButton className="btn-secondary">Comment</SubmitButton>
    </ActionForm>
  )
}
