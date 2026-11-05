'use client'

import { useState } from 'react'
import { admissionAction, archiveAction, assignAction, changeStageAction, followupAction, mergeAction, noteAction, visaAction } from '@/app/actions/students'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

type Opt = { value: string; label: string }

export function StageChangeForm({ studentId, stages, current }: { studentId: string; stages: { key: string; name: string; kind: string }[]; current: string }) {
  const [to, setTo] = useState('')
  const needsReason = ['on_hold', 'cancelled'].includes(to)
  return (
    <ActionForm action={changeStageAction.bind(null, studentId)} resetOnSuccess>
      {(s) => {
        const warnings = (s.data?.warnings as string[] | undefined) ?? []
        return (
          <>
            <p className="text-sm text-slate-600">Current stage: <strong>{current}</strong></p>
            <div>
              <label className="label" htmlFor="toStage">Move to</label>
              <select id="toStage" name="toStage" className="input" required value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose a stage…</option>
                {stages.map((st) => <option key={st.key} value={st.key}>{st.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="reason">{needsReason ? 'Reason (required)' : 'Reason / note (optional)'}</label>
              <textarea id="reason" name="reason" rows={2} className="input" required={needsReason} maxLength={1000} />
              <FieldError state={s} name="reason" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="nextAction">Next action</label><input id="nextAction" name="nextAction" className="input" maxLength={300} /></div>
              <div><label className="label" htmlFor="nextActionDue">Due date</label><input id="nextActionDue" name="nextActionDue" type="date" className="input" /></div>
            </div>
            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                <label className="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" name="acknowledge" value="yes" required /> I understand and want to continue</label>
              </div>
            )}
            <SubmitButton>Update stage</SubmitButton>
          </>
        )
      }}
    </ActionForm>
  )
}

export function AssignmentForm({ studentId, type, label, current, options }: { studentId: string; type: string; label: string; current?: string; options: Opt[] }) {
  return (
    <ActionForm action={assignAction.bind(null, studentId)} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="assignmentType" value={type} />
      <div className="min-w-48 flex-1">
        <label className="label" htmlFor={`assign-${type}`}>{label}</label>
        <select id={`assign-${type}`} name="assignee" className="input" defaultValue={current ?? ''}>
          <option value="">— Unassigned —</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <SubmitButton className="btn-secondary">Save</SubmitButton>
    </ActionForm>
  )
}

export function NoteForm({ studentId, orgs, canRestricted }: { studentId: string; orgs: Opt[]; canRestricted: boolean }) {
  return (
    <ActionForm action={noteAction.bind(null, studentId)} resetOnSuccess>
      {(s) => (
        <>
          {orgs.length > 1 ? (
            <div><label className="label" htmlFor="note-org">Recorded by company</label>
              <select id="note-org" name="orgId" className="input">{orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
          ) : <input type="hidden" name="orgId" value={orgs[0]?.value} />}
          <div>
            <label className="label" htmlFor="body">Internal note</label>
            <textarea id="body" name="body" rows={3} className="input" required maxLength={5000} />
            <FieldError state={s} name="body" />
          </div>
          {canRestricted && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="visibility" value="restricted" /> Restricted (only managers / MD can read)</label>
          )}
          <SubmitButton>Add note</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}

export function FollowupForm({ studentId, orgs }: { studentId: string; orgs: Opt[] }) {
  return (
    <ActionForm action={followupAction.bind(null, studentId)} resetOnSuccess>
      {(s) => (
        <>
          {orgs.length > 1 ? (
            <div><label className="label" htmlFor="fu-org">Company</label>
              <select id="fu-org" name="orgId" className="input">{orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
          ) : <input type="hidden" name="orgId" value={orgs[0]?.value} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="channel">Channel</label>
              <select id="channel" name="channel" className="input">
                <option value="call">Phone call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option>
                <option value="in_person">In person</option><option value="video">Video call</option><option value="other">Other</option>
              </select></div>
            <div><label className="label" htmlFor="nextFollowupDate">Next follow-up</label><input id="nextFollowupDate" name="nextFollowupDate" type="date" className="input" /></div>
          </div>
          <div>
            <label className="label" htmlFor="summary">Summary</label>
            <textarea id="summary" name="summary" rows={2} className="input" required maxLength={2000} />
            <FieldError state={s} name="summary" />
          </div>
          <SubmitButton>Log follow-up</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}

export function VisaForm({ studentId, appointment, outcome, reference }: { studentId: string; appointment: string | null; outcome: string; reference: string | null }) {
  return (
    <ActionForm action={visaAction.bind(null, studentId)} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div><label className="label" htmlFor="visaAppointmentDate">Appointment date</label><input id="visaAppointmentDate" name="visaAppointmentDate" type="date" className="input" defaultValue={appointment ?? ''} /></div>
      <div><label className="label" htmlFor="visaOutcome">Outcome</label>
        <select id="visaOutcome" name="visaOutcome" className="input" defaultValue={outcome}>
          <option value="not_applied">Not applied</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
        </select></div>
      <div><label className="label" htmlFor="visaReference">Reference / tracking no.</label><input id="visaReference" name="visaReference" className="input" maxLength={100} defaultValue={reference ?? ''} /></div>
      <div className="sm:col-span-3"><SubmitButton className="btn-secondary">Save visa details</SubmitButton></div>
    </ActionForm>
  )
}

export function AdmissionForm({ studentId, applicationRef, letterDate }: { studentId: string; applicationRef: string | null; letterDate: string | null }) {
  return (
    <ActionForm action={admissionAction.bind(null, studentId)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div><label className="label" htmlFor="universityApplicationRef">University application ref.</label><input id="universityApplicationRef" name="universityApplicationRef" className="input" maxLength={100} defaultValue={applicationRef ?? ''} /></div>
      <div><label className="label" htmlFor="admissionLetterDate">Admission letter received</label><input id="admissionLetterDate" name="admissionLetterDate" type="date" className="input" defaultValue={letterDate ?? ''} /></div>
      <div className="sm:col-span-2"><SubmitButton className="btn-secondary">Save admission details</SubmitButton></div>
    </ActionForm>
  )
}

export function MergeForm({ studentId, code }: { studentId: string; code: string }) {
  return (
    <ActionForm action={mergeAction.bind(null, studentId)} resetOnSuccess>
      {(s) => (
        <>
          <p className="text-sm text-slate-600">Merge a duplicate record <strong>into</strong> this one ({code}). Notes, follow-ups, tasks, documents, payments and due dates, preferences, student questions and pre-admission links move here; the duplicate is kept for history. You need merge permission in both companies.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="mergedCode">Duplicate Student ID</label><input id="mergedCode" name="mergedCode" className="input font-mono" placeholder="GRD-26-001234" required /></div>
            <div><label className="label" htmlFor="merge-reason">Reason</label><input id="merge-reason" name="reason" className="input" required maxLength={500} /><FieldError state={s} name="reason" /></div>
          </div>
          <ConfirmSubmit confirmText="Merge the records? This cannot be undone from the app.">Merge duplicate</ConfirmSubmit>
        </>
      )}
    </ActionForm>
  )
}

export function ArchiveForm({ studentId, archived }: { studentId: string; archived: boolean }) {
  return (
    <ActionForm action={archiveAction.bind(null, studentId)}>
      <input type="hidden" name="archive" value={archived ? 'no' : 'yes'} />
      {!archived && (
        <div><label className="label" htmlFor="archive-reason">Reason for archiving</label><input id="archive-reason" name="reason" className="input" required maxLength={500} /></div>
      )}
      {archived
        ? <SubmitButton className="btn-secondary">Restore record</SubmitButton>
        : <ConfirmSubmit confirmText="Archive this student? It will be hidden from normal lists.">Archive record</ConfirmSubmit>}
    </ActionForm>
  )
}
