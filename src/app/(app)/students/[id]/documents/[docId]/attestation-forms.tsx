'use client'

import { useState } from 'react'
import { cancelAttestationAction, startAttestationAction, stepAction, stepFileAction } from '@/app/actions/attestation'
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/components/forms'

export function StartAttestationForm({ studentId, docId, routes }: { studentId: string; docId: string; routes: { id: string; label: string; stages: string[] }[] }) {
  const [sel, setSel] = useState(routes.length === 1 ? routes[0].id : '')
  return (
    <ActionForm action={startAttestationAction.bind(null, studentId, docId)}>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Choose the route</legend>
        {routes.map((r) => (
          <label key={r.id} className={`block rounded-md border p-3 text-sm ${sel === r.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
            <input type="radio" name="routeId" value={r.id} checked={sel === r.id} onChange={() => setSel(r.id)} className="mr-2" />
            <span className="font-medium">{r.label}</span>
            <span className="mt-1 block text-xs text-slate-600">{r.stages.join(' → ')}</span>
          </label>
        ))}
      </fieldset>
      <SubmitButton>Start attestation</SubmitButton>
    </ActionForm>
  )
}

export function StepForms({ studentId, docId, step, canException, staff }: {
  studentId: string; docId: string
  step: { id: string; status: string; is_mandatory: boolean; requires_reference: boolean; requires_supporting_file: boolean; reference_no: string | null; assigned_to: string | null }
  canException: boolean; staff: { id: string; full_name: string }[]
}) {
  const [mode, setMode] = useState<'' | 'not_required' | 'exception'>('')
  const today = new Date().toISOString().slice(0, 10)
  const act = stepAction.bind(null, studentId, docId, step.id)
  return (
    <div className="mt-3 space-y-3 rounded-md bg-slate-50 p-3">
      <ActionForm action={act} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <div><label className="label text-xs" htmlFor={`ref-${step.id}`}>Reference / tracking no.{step.requires_reference && ' *'}</label>
          <input className="input py-1 text-sm" id={`ref-${step.id}`} name="reference" defaultValue={step.reference_no ?? ''} maxLength={120} /></div>
        <div><label className="label text-xs" htmlFor={`date-${step.id}`}>Processing date</label>
          <input className="input py-1 text-sm" id={`date-${step.id}`} name="date" type="date" defaultValue={today} /></div>
        <div className="sm:col-span-2"><label className="label text-xs" htmlFor={`cm-${step.id}`}>Comments</label>
          <input className="input py-1 text-sm" id={`cm-${step.id}`} name="comment" maxLength={2000} /></div>
        <div className="flex flex-wrap gap-2 sm:col-span-4">
          {step.status === 'pending' && <SubmitButton name="action" value="start" className="btn-secondary btn-sm">Mark started / submitted</SubmitButton>}
          <SubmitButton name="action" value="complete" className="btn-primary btn-sm">Mark completed</SubmitButton>
          <SubmitButton name="action" value="note" className="btn-ghost btn-sm">Save details</SubmitButton>
        </div>
      </ActionForm>
      <ActionForm action={stepFileAction.bind(null, studentId, docId, step.id)} className="flex flex-wrap items-center gap-2" resetOnSuccess>
        <label className="text-xs text-slate-600" htmlFor={`sf-${step.id}`}>Supporting document{step.requires_supporting_file && ' (required)'}:</label>
        <input id={`sf-${step.id}`} type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="text-xs" />
        <SubmitButton className="btn-secondary btn-sm">Upload</SubmitButton>
      </ActionForm>
      <ActionForm action={act} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="action" value="assign" />
        <div><label className="label text-xs" htmlFor={`as-${step.id}`}>Responsible staff</label>
          <select className="input py-1 text-sm" id={`as-${step.id}`} name="assignee" defaultValue={step.assigned_to ?? ''}>
            <option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select></div>
        <SubmitButton className="btn-ghost btn-sm">Assign</SubmitButton>
      </ActionForm>
      <div className="flex flex-wrap gap-2 text-xs">
        {!step.is_mandatory && <button type="button" className="btn-ghost btn-sm" onClick={() => setMode(mode === 'not_required' ? '' : 'not_required')}>Not required…</button>}
        {step.is_mandatory && canException && <button type="button" className="btn-ghost btn-sm" onClick={() => setMode(mode === 'exception' ? '' : 'exception')}>Skip with exception…</button>}
      </div>
      {mode && (
        <ActionForm action={act} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="action" value={mode} />
          <label className="sr-only" htmlFor={`rs-${step.id}`}>Reason</label>
          <input id={`rs-${step.id}`} name="comment" className="input min-w-60 flex-1 py-1 text-sm" placeholder="Reason (required, recorded and audited)" required />
          <ConfirmSubmit className={mode === 'exception' ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'} confirmText={mode === 'exception' ? 'Skip this mandatory stage?' : 'Mark as not required?'}>
            {mode === 'exception' ? 'Record exception' : 'Mark not required'}</ConfirmSubmit>
        </ActionForm>
      )}
    </div>
  )
}

export function CancelAttestationForm({ studentId, docId, attestationId }: { studentId: string; docId: string; attestationId: string }) {
  return (
    <ActionForm action={cancelAttestationAction.bind(null, studentId, docId, attestationId)} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="cancel-reason">Reason</label>
      <input id="cancel-reason" name="reason" className="input min-w-60 flex-1 py-1 text-sm" placeholder="Reason for cancelling" required />
      <ConfirmSubmit className="btn-secondary btn-sm" confirmText="Cancel this attestation?">Cancel attestation</ConfirmSubmit>
    </ActionForm>
  )
}
