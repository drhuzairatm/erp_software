'use client'

import { useState } from 'react'
import { addRequirementAction, approveRuleAction, deleteDraftAction, newVersionAction, removeRequirementAction, saveRuleAction } from '@/app/actions/verification-rules'
import { ConditionBuilder, type ConditionOptions } from '@/components/condition-builder'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'
import type { Condition } from '@/lib/conditions'

type Opt = { value: string; label: string }

export function RuleForm({ id, options, initial, readOnly, condOptions, conditions, conditionsText }: {
  id: string | null; readOnly?: boolean; condOptions: ConditionOptions; conditions?: Condition | null; conditionsText?: string
  options: { documentTypes: Opt[]; countries: Opt[]; universities: Opt[]; courses: Opt[] }
  initial?: Record<string, string | null>
}) {
  const v = (k: string) => initial?.[k] ?? ''
  const sel = (name: string, labelText: string, opts: Opt[], any = 'Any') => (
    <div>
      <label className="label" htmlFor={name}>{labelText}</label>
      <select className="input" id={name} name={name} defaultValue={v(name)} disabled={readOnly}>
        <option value="">{any}</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
  return (
    <ActionForm action={saveRuleAction.bind(null, id)} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {(s) => (
        <>
          <div className="md:col-span-2"><label className="label" htmlFor="name">Rule name</label>
            <input className="input" id="name" name="name" required defaultValue={v('name')} disabled={readOnly} placeholder="e.g. Bonafide – students educated in Qatar" />
            <FieldError state={s} name="name" /></div>
          <div><label className="label" htmlFor="documentTypeId">Document type</label>
            <select className="input" id="documentTypeId" name="documentTypeId" required defaultValue={v('documentTypeId')} disabled={readOnly}>
              <option value="" disabled>Choose…</option>{options.documentTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select><FieldError state={s} name="documentTypeId" /></div>
          {sel('previousEducationCountryId', 'Previous education country', options.countries)}
          {sel('destinationCountryId', 'Destination country', options.countries)}
          {sel('universityId', 'University', options.universities)}
          {sel('courseId', 'Course', options.courses)}
          <div className="md:col-span-2"><label className="label" htmlFor="description">Description / source of the wording</label>
            <input className="input" id="description" name="description" defaultValue={v('description')} disabled={readOnly} /></div>
          <div className="md:col-span-3">{readOnly
            ? <p className="text-sm"><span className="label inline">Extra conditions: </span>{conditionsText ?? 'No extra conditions'}</p>
            : <><ConditionBuilder initial={conditions ?? null} options={condOptions} label="Extra conditions (optional) – e.g. nationality, school country, age" /><FieldError state={s} name="conditions" /></>}</div>
          {!readOnly && <div className="md:col-span-3"><SubmitButton>{id ? 'Save draft' : 'Create draft'}</SubmitButton></div>}
          <p className="hint md:col-span-3">Leave a scope as “Any” to apply to all. A rule applies to a document only when every chosen scope matches the student.</p>
        </>
      )}
    </ActionForm>
  )
}

export function AddRequirementForm({ ruleId }: { ruleId: string }) {
  const [kind, setKind] = useState('exact_phrase')
  return (
    <ActionForm action={addRequirementAction.bind(null, ruleId)} className="grid grid-cols-1 gap-3 md:grid-cols-4" resetOnSuccess>
      {(s) => (
        <>
          <div><label className="label" htmlFor="kind">Type of check</label>
            <select className="input" id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="exact_phrase">Exact phrase must appear</option><option value="statement">Statement (same meaning)</option>
              <option value="keywords">Keywords must appear</option><option value="manual_check">Manual check (e.g. signature, stamp)</option>
            </select></div>
          <div className="md:col-span-3"><label className="label" htmlFor="text">{kind === 'manual_check' ? 'What to check' : kind === 'keywords' ? 'Description' : 'Required wording'}</label>
            <textarea className="input" id="text" name="text" rows={2} required maxLength={2000} /><FieldError state={s} name="text" /></div>
          {kind === 'keywords' && (
            <div className="md:col-span-2"><label className="label" htmlFor="keywords">Keywords (comma-separated, all must appear)</label>
              <input className="input" id="keywords" name="keywords" placeholder="eligible, higher education, abroad" /><FieldError state={s} name="keywords" /></div>
          )}
          <div className="md:col-span-2"><label className="label" htmlFor="guidance">Guidance for staff (optional)</label><input className="input" id="guidance" name="guidance" /></div>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="optional" value="yes" /> Optional (not mandatory)</label>
          <div className="flex items-end"><SubmitButton className="btn-secondary">Add check</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function RemoveRequirementButton({ ruleId, reqId }: { ruleId: string; reqId: string }) {
  return <ActionForm action={removeRequirementAction.bind(null, ruleId, reqId)} className="inline"><SubmitButton className="btn-ghost btn-sm">Remove</SubmitButton></ActionForm>
}

export function ApproveRuleButton({ ruleId }: { ruleId: string }) {
  return (
    <ActionForm action={approveRuleAction.bind(null, ruleId)}>
      <ConfirmSubmit className="btn-primary" confirmText="Approve this wording? It will apply to document verification from today.">Approve rule</ConfirmSubmit>
    </ActionForm>
  )
}

export function NewVersionButton({ ruleId }: { ruleId: string }) {
  return <ActionForm action={newVersionAction.bind(null, ruleId)}><SubmitButton className="btn-secondary">Create new version to edit</SubmitButton></ActionForm>
}

export function DeleteDraftButton({ ruleId }: { ruleId: string }) {
  return <ActionForm action={deleteDraftAction.bind(null, ruleId)}><ConfirmSubmit className="btn-ghost" confirmText="Delete this draft?">Delete draft</ConfirmSubmit></ActionForm>
}
