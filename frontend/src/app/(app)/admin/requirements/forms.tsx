'use client'

import { useState } from 'react'
import { requirementStatusAction, saveRequirementAction } from '@/app/actions/requirements'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

type Opt = { id: string; name: string }
type Item = { record_kind: string; subject_key: string; subject_name: string; min_percentage: string | null; min_marks: string | null; grading_system: string | null }
export interface RequirementInitial {
  category: string; display_type: string; priority: string; destination_country_id: string; university_id: string | null; course_id: string | null
  title: string; message: string; description: string | null; notes: string | null; requires_acknowledgement: boolean; effective_from: string; effective_to: string | null; items: Item[]
}
const CATEGORIES: Record<string, string> = { academic_marks: 'Academic marks', age: 'Age recommendation', subject_prerequisite: 'Subject prerequisites', language: 'Language requirement',
  entrance_exam: 'Entrance examination', document: 'Document requirement', nationality: 'Nationality-specific note', general: 'General' }
const DISPLAY: Record<string, string> = { critical_alert: 'Critical alert (red)', mandatory_notice: 'Mandatory notice (amber, highlighted)', important_warning: 'Important warning (amber)',
  additional_point: 'Additional point (blue)', general_information: 'General information (blue)' }
const PRIORITY: Record<string, string> = { critical: 'Critical', high: 'High', normal: 'Normal (collapsed)', informational: 'Informational (collapsed)' }
const SUBJECTS: Record<string, string> = { physics: 'Physics', chemistry: 'Chemistry', biology: 'Biology', mathematics: 'Mathematics', english: 'English', overall: 'Overall result' }

export function RequirementForm({ groupId, initial, countries, universities, courses }: { groupId: string | null; initial?: RequirementInitial; countries: Opt[]; universities: Opt[]; courses: Opt[] }) {
  const [category, setCategory] = useState(initial?.category ?? 'academic_marks')
  const [items, setItems] = useState<(Item & { k: number })[]>((initial?.items ?? []).map((x, i) => ({ k: i, ...x })))
  const v = (k: keyof RequirementInitial) => (initial?.[k] == null ? '' : String(initial[k]))
  const sel = (name: string, label: string, opts: [string, string][], def: string, required = false) => (
    <div><label className="label" htmlFor={`rq-${name}`}>{label}{required && ' *'}</label>
      <select className="input" id={`rq-${name}`} name={name} defaultValue={def} required={required}>
        {!required && <option value="">Any</option>}{opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
  )
  return (
    <ActionForm action={saveRequirementAction.bind(null, groupId)} className="space-y-4">
      {(s) => (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><label className="label" htmlFor="rq-country">Country *</label>
              <select className="input" id="rq-country" name="destinationCountryId" defaultValue={v('destination_country_id')} required>
                <option value="" disabled>Choose…</option>{countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <FieldError state={s} name="destinationCountryId" /></div>
            {sel('universityId', 'University (optional)', universities.map((u) => [u.id, u.name]), v('university_id'))}
            {sel('courseId', 'Course (optional)', courses.map((c) => [c.id, c.name]), v('course_id'))}
            <div><label className="label" htmlFor="rq-cat">Category *</label>
              <select className="input" id="rq-cat" name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(CATEGORIES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
            {sel('displayType', 'Display category *', Object.entries(DISPLAY), v('display_type') || 'important_warning', true)}
            {sel('priority', 'Priority *', Object.entries(PRIORITY), v('priority') || 'high', true)}
            <div className="md:col-span-3"><label className="label" htmlFor="rq-title">Notification title *</label>
              <input className="input" id="rq-title" name="title" defaultValue={v('title')} required maxLength={200} placeholder="e.g. BULGARIA – IMPORTANT ACADEMIC REQUIREMENTS" />
              <FieldError state={s} name="title" /></div>
            <div className="md:col-span-3"><label className="label" htmlFor="rq-msg">Notification message *</label>
              <textarea className="input min-h-20" id="rq-msg" name="message" defaultValue={v('message')} required maxLength={4000} />
              <FieldError state={s} name="message" /></div>
            <div className="md:col-span-3"><label className="label" htmlFor="rq-desc">Requirement description</label>
              <textarea className="input min-h-16" id="rq-desc" name="description" defaultValue={v('description')} maxLength={4000} /></div>
            <div className="md:col-span-3"><label className="label" htmlFor="rq-notes">Additional notes</label>
              <textarea className="input min-h-16" id="rq-notes" name="notes" defaultValue={v('notes')} maxLength={4000} /></div>
            <div><label className="label" htmlFor="rq-from">Effective from</label><input className="input" id="rq-from" name="effectiveFrom" type="date" defaultValue={v('effective_from')} /></div>
            <div><label className="label" htmlFor="rq-to">Expires (optional)</label><input className="input" id="rq-to" name="effectiveTo" type="date" defaultValue={v('effective_to')} /><FieldError state={s} name="effectiveTo" /></div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="requiresAcknowledgement" value="yes" defaultChecked={initial ? initial.requires_acknowledgement : true} /> Staff must acknowledge</label>
          </div>
          {category === 'academic_marks' && (
            <fieldset className="rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium">Subject requirements</legend>
              <div className="space-y-2">{items.map((it, i) => (
                <div key={it.k} className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-12">
                  <select className="input py-1 text-sm md:col-span-2" name="itemRecordKind" aria-label={`Requirement ${i + 1} qualification`} defaultValue={it.record_kind}>
                    <option value="plus_two">Plus Two</option><option value="class_10">Class 10</option><option value="bachelor">Bachelor&apos;s</option><option value="mbbs">MBBS</option></select>
                  <select className="input py-1 text-sm md:col-span-2" name="itemSubjectKey" aria-label={`Requirement ${i + 1} subject`} defaultValue={it.subject_key}
                    onChange={(e) => setItems(items.map((x) => (x.k === it.k ? { ...x, subject_key: e.target.value, subject_name: x.subject_name || SUBJECTS[e.target.value] } : x)))}>
                    {Object.entries(SUBJECTS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
                  <input className="input py-1 text-sm md:col-span-3" name="itemSubjectName" aria-label={`Requirement ${i + 1} subject name`} defaultValue={it.subject_name} placeholder="Subject name shown" />
                  <input className="input py-1 text-sm md:col-span-1" name="itemMinPercentage" aria-label={`Requirement ${i + 1} minimum percentage`} defaultValue={it.min_percentage ?? ''} placeholder="Min %" inputMode="decimal" />
                  <input className="input py-1 text-sm md:col-span-1" name="itemMinMarks" aria-label={`Requirement ${i + 1} minimum marks`} defaultValue={it.min_marks ?? ''} placeholder="or marks" inputMode="decimal" />
                  <select className="input py-1 text-sm md:col-span-2" name="itemGrading" aria-label={`Requirement ${i + 1} grading system`} defaultValue={it.grading_system ?? ''}>
                    <option value="">Any grading system</option><option value="percentage">Percentage</option><option value="marks">Marks</option></select>
                  <button type="button" className="btn-ghost btn-sm" aria-label={`Remove requirement ${i + 1}`} onClick={() => setItems(items.filter((x) => x.k !== it.k))}>×</button>
                </div>))}
              </div>
              <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => setItems([...items, { k: Date.now(), record_kind: 'plus_two', subject_key: 'chemistry', subject_name: 'Chemistry', min_percentage: '', min_marks: '', grading_system: '' }])}>+ Add subject requirement</button>
            </fieldset>
          )}
          {groupId && <div><label className="label" htmlFor="rq-reason">Reason for the change *</label>
            <input className="input" id="rq-reason" name="reason" required placeholder="Recorded in the history; earlier versions are kept for students already reviewed" /></div>}
          <p className="hint">Requirement notices are advisory: they are shown to staff and can require acknowledgement, but never block or reject an application.</p>
          <SubmitButton>{groupId ? 'Save as new version' : 'Create requirement'}</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}

export function StatusForm({ groupId, active }: { groupId: string; active: boolean }) {
  return (
    <ActionForm action={requirementStatusAction.bind(null, groupId, !active)} className="flex flex-wrap items-center gap-2">
      <input name="reason" aria-label="Reason" className="input min-w-full flex-1 py-1 text-sm sm:min-w-56" placeholder="Reason (recorded)" required />
      <ConfirmSubmit className={active ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'} confirmText={active ? 'Deactivate this requirement?' : 'Activate this requirement?'}>
        {active ? 'Deactivate' : 'Activate'}</ConfirmSubmit>
    </ActionForm>
  )
}
