'use client'

import { useState } from 'react'
import { commentAction, createTaskAction, extendTaskAction, reviewTaskAction, saveTaskRemindersAction, submitTaskAction, updateTaskAction } from '@/app/actions/tasks'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'
import { DELAY_REASONS, PRIORITIES, TASK_STATUSES, TASK_TYPES } from '@/lib/validation'

const PRIORITY_LABEL: Record<string, string> = { urgent: 'Critical', high: 'High', normal: 'Medium', low: 'Low' }
const TASK_STATUS_LABEL: Record<string, string> = { not_started: 'Pending', in_progress: 'In progress', waiting_external: 'Waiting on someone else', submitted: 'Submitted', completed: 'Completed', cancelled: 'Cancelled' }
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
            <select className="input" id="priority" name="priority" defaultValue="normal">{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p] ?? lbl(p)}</option>)}</select></div>
          <div><label className="label" htmlFor="startDate">Start date</label><input className="input" id="startDate" name="startDate" type="date" /></div>
          <div><label className="label" htmlFor="dueDate">Deadline date</label><input className="input" id="dueDate" name="dueDate" type="date" /></div>
          <div><label className="label" htmlFor="dueTime">Deadline time (optional)</label><input className="input" id="dueTime" name="dueTime" type="time" /><FieldError state={s} name="dueTime" /></div>
          <div className="md:col-span-2"><label className="label" htmlFor="completionInstructions">Completion instructions</label><textarea className="input" id="completionInstructions" name="completionInstructions" rows={2} maxLength={4000} /></div>
          <div className="md:col-span-2 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="requiresReview" defaultChecked />A manager must approve before it is completed</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="evidenceRequired" />Evidence is required</label></div>
          <div><label className="label" htmlFor="status">Status</label>
            <select className="input" id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value)}>{TASK_STATUSES.filter((x) => x !== 'completed' && x !== 'cancelled').map((x) => <option key={x} value={x}>{TASK_STATUS_LABEL[x] ?? lbl(x)}</option>)}</select></div>
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
            <select className="input" id="status" name="status" value={st} onChange={(e) => setSt(e.target.value)}>{TASK_STATUSES.map((x) => <option key={x} value={x}>{TASK_STATUS_LABEL[x] ?? lbl(x)}</option>)}</select></div>
          <div><label className="label" htmlFor="priority">Priority</label>
            <select className="input" id="priority" name="priority" defaultValue={priority}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p] ?? lbl(p)}</option>)}</select></div>
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

export function ProgressForm({ id, value }: { id: string; value: number }) {
  return (
    <ActionForm action={updateTaskAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
      <div><label className="label" htmlFor="progressPercent">Progress (%)</label><input className="input w-24" id="progressPercent" name="progressPercent" type="number" min={0} max={100} defaultValue={value} /></div>
      <SubmitButton className="btn-secondary btn-sm">Save progress</SubmitButton>
    </ActionForm>
  )
}

export function SubmitTaskForm({ id, evidenceRequired }: { id: string; evidenceRequired: boolean }) {
  return (
    <ActionForm action={submitTaskAction.bind(null, id)} className="space-y-2" resetOnSuccess>
      <label className="label" htmlFor="submit-note">Note for the reviewer</label>
      <textarea className="input" id="submit-note" name="note" rows={2} maxLength={2000} />
      {evidenceRequired && <p className="hint">This task needs evidence: attach your file under Files first.</p>}
      <SubmitButton>Submit for review</SubmitButton>
    </ActionForm>
  )
}

export function ReviewTaskForm({ id }: { id: string }) {
  return (
    <ActionForm action={reviewTaskAction.bind(null, id)} className="space-y-2">
      <label className="label" htmlFor="review-note">Review note (required for corrections)</label>
      <textarea className="input" id="review-note" name="note" rows={2} maxLength={2000} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="approved">Approve</SubmitButton>
        <SubmitButton name="decision" value="corrections" className="btn-secondary">Request corrections</SubmitButton>
      </div>
    </ActionForm>
  )
}

export function ExtendTaskForm({ id }: { id: string }) {
  return (
    <ActionForm action={extendTaskAction.bind(null, id)} className="grid grid-cols-1 gap-2 md:grid-cols-3" resetOnSuccess>
      {(s) => (<>
        <div><label className="label" htmlFor="ext-date">New date</label><input className="input" id="ext-date" name="date" type="date" required /><FieldError state={s} name="date" /></div>
        <div><label className="label" htmlFor="ext-time">New time</label><input className="input" id="ext-time" name="time" type="time" required /></div>
        <div><label className="label" htmlFor="ext-reason">Reason</label><input className="input" id="ext-reason" name="reason" required maxLength={1000} /></div>
        <div className="md:col-span-3"><SubmitButton className="btn-secondary btn-sm">Extend deadline</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}

const REMINDER_CHOICES: [number, string][] = [[1440, '1 day before'], [360, '6 hours before'], [180, '3 hours before'], [120, '2 hours before'], [60, '1 hour before']]
export function TaskRemindersForm({ orgId, v }: { orgId: string; v: { before_minutes: number[]; at_deadline: boolean; after_overdue: boolean; escalate: boolean } }) {
  return (
    <ActionForm action={saveTaskRemindersAction.bind(null, orgId)} className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        {REMINDER_CHOICES.map(([m, t]) => <label key={m} className="flex items-center gap-2"><input type="checkbox" name="before" value={m} defaultChecked={v.before_minutes.includes(m)} />{t}</label>)}
        <label className="flex items-center gap-2"><input type="checkbox" name="atDeadline" defaultChecked={v.at_deadline} />At the deadline</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="afterOverdue" defaultChecked={v.after_overdue} />A day after it is overdue</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="escalate" defaultChecked={v.escalate} />Escalate to the manager</label>
      </div>
      <SubmitButton className="btn-secondary btn-sm">Save reminders</SubmitButton>
    </ActionForm>
  )
}
