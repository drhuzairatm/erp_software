'use client'

import { useState } from 'react'
import { cancelOasAction, deleteRecordAction, prepareOasAction, requestOasAction, reviewNameCheckAction, saveRecordAction } from '@/app/actions/academic'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

type Opt = { id: string; name: string }
const KINDS: Record<string, string> = {
  class_10: 'Class 10 / Secondary', plus_two: 'Plus Two / Higher Secondary (Class 12)', bachelor: "Bachelor's degree",
  mbbs: 'MBBS degree', internship: 'Internship', medical_registration: 'Medical registration', other: 'Other qualification',
}
const GRADING: Record<string, string> = { percentage: 'Percentage', marks: 'Marks (obtained / total)', cgpa_10: 'CGPA (out of 10)', cgpa_4: 'GPA (out of 4)', letter_grade: 'Letter grades', other: 'Other' }
const SUBJECTS: Record<string, string> = { physics: 'Physics', chemistry: 'Chemistry', biology: 'Biology', mathematics: 'Mathematics', english: 'English', other: 'Other' }
const SCHOOL_DEFAULT = ['physics', 'chemistry', 'biology', 'english']

export interface RecordFormValues {
  id?: string; kind?: string; title?: string | null; name_on_certificate?: string | null; certificate_number?: string | null; register_number?: string | null
  board?: string | null; institution_name?: string | null; institution_country_id?: string | null; issuing_country_id?: string | null; year_of_passing?: number | null
  stream?: string | null; grading_system?: string | null; total_marks?: string | null; marks_obtained?: string | null; percentage?: string | null; cgpa?: string | null
  grade?: string | null; issue_date?: string | null; start_date?: string | null; end_date?: string | null; registration_authority?: string | null
  registration_number?: string | null; registration_valid_until?: string | null; notes?: string | null
  subjects?: { subject_key: string; subject_name: string; max_marks: string | null; marks_obtained: string | null; percentage: string | null; grade: string | null }[]
}

export function RecordForm({ studentId, countries, kinds, initial, onDone }: { studentId: string; countries: Opt[]; kinds: string[]; initial?: RecordFormValues; onDone?: () => void }) {
  const [kind, setKind] = useState(initial?.kind ?? kinds[0])
  const [grading, setGrading] = useState(initial?.grading_system ?? 'percentage')
  const [rows, setRows] = useState(() => initial?.subjects?.length ? initial.subjects.map((x, i) => ({ k: i, ...x }))
    : (initial?.id ? [] : SCHOOL_DEFAULT.map((key, i) => ({ k: i, subject_key: key, subject_name: SUBJECTS[key], max_marks: '100', marks_obtained: '', percentage: '', grade: '' }))))
  const v = (k: keyof RecordFormValues) => (initial?.[k] == null ? '' : String(initial[k]))
  const school = ['class_10', 'plus_two', 'bachelor', 'mbbs', 'other'].includes(kind)
  const field = (name: string, label: string, def: string, opts: { type?: string; span?: boolean; max?: number } = {}) => (
    <div className={opts.span ? 'md:col-span-2' : ''}><label className="label" htmlFor={`ar-${name}`}>{label}</label>
      <input className="input" id={`ar-${name}`} name={name} type={opts.type ?? 'text'} defaultValue={def} maxLength={opts.max ?? 200} step={opts.type === 'number' ? 'any' : undefined} /></div>
  )
  const csel = (name: string, label: string, def: string) => (
    <div><label className="label" htmlFor={`ar-${name}`}>{label}</label>
      <select className="input" id={`ar-${name}`} name={name} defaultValue={def}><option value="">—</option>{countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
  )
  return (
    <ActionForm action={saveRecordAction.bind(null, studentId, initial?.id ?? null)} className="space-y-4" resetOnSuccess={!initial?.id} onSuccess={onDone}>
      {(s) => (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><label className="label" htmlFor="ar-kind">Qualification</label>
              <select className="input" id="ar-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {kinds.map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}
              </select></div>
            {kind === 'other' && field('title', 'Name of qualification', v('title'), { max: 120 })}
            {kind !== 'medical_registration' && field('nameOnCertificate', 'Student name as printed on the certificate', v('name_on_certificate'), { span: kind !== 'other' })}
            {school && field('certificateNumber', 'Certificate number', v('certificate_number'), { max: 60 })}
            {school && field('registerNumber', 'Register / roll number', v('register_number'), { max: 60 })}
            {school && field('board', kind === 'mbbs' || kind === 'bachelor' ? 'University' : 'Board', v('board'), { max: 160 })}
            {kind !== 'medical_registration' && field('institutionName', kind === 'internship' ? 'Hospital / institution' : 'School / institution', v('institution_name'))}
            {kind !== 'medical_registration' && csel('institutionCountryId', 'Institution country', v('institution_country_id'))}
            {csel('issuingCountryId', 'Certificate issuing country', v('issuing_country_id'))}
            {school && field('yearOfPassing', 'Year of passing', v('year_of_passing'), { type: 'number' })}
            {kind === 'plus_two' && field('stream', 'Stream / group', v('stream'), { max: 80 })}
            {school && field('issueDate', 'Certificate issue date', v('issue_date'), { type: 'date' })}
            {kind === 'internship' && field('startDate', 'Internship start', v('start_date'), { type: 'date' })}
            {kind === 'internship' && field('endDate', 'Internship end', v('end_date'), { type: 'date' })}
            {kind === 'medical_registration' && field('registrationAuthority', 'Medical council / authority', v('registration_authority'), { max: 160 })}
            {kind === 'medical_registration' && field('registrationNumber', 'Registration number', v('registration_number'), { max: 60 })}
            {kind === 'medical_registration' && field('registrationValidUntil', 'Valid until', v('registration_valid_until'), { type: 'date' })}
          </div>
          {school && (
            <fieldset className="rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium">Result</legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div><label className="label" htmlFor="ar-grading">Grading system</label>
                  <select className="input" id="ar-grading" name="gradingSystem" value={grading} onChange={(e) => setGrading(e.target.value)}>
                    {Object.entries(GRADING).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select></div>
                {(grading === 'marks' || grading === 'percentage') && field('totalMarks', 'Total marks', v('total_marks'), { type: 'number' })}
                {(grading === 'marks' || grading === 'percentage') && field('marksObtained', 'Marks obtained', v('marks_obtained'), { type: 'number' })}
                {grading === 'percentage' && field('percentage', 'Percentage (as printed)', v('percentage'), { type: 'number' })}
                {(grading === 'cgpa_10' || grading === 'cgpa_4') && field('cgpa', grading === 'cgpa_4' ? 'GPA' : 'CGPA', v('cgpa'), { type: 'number' })}
                {(grading === 'letter_grade' || grading === 'other') && field('grade', 'Grade / result', v('grade'), { max: 20 })}
              </div>
              <p className="hint mt-1">CGPA and letter grades are never converted to a percentage automatically; thresholds then need a manual check.</p>
              <FieldError state={s} name="marksObtained" />
            </fieldset>
          )}
          {school && (
            <fieldset className="rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium">Subjects</legend>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={r.k} className="grid grid-cols-2 gap-2 md:grid-cols-8">
                    <select className="input py-1 text-sm md:col-span-2" name="subjectKey" aria-label={`Subject ${i + 1} type`} defaultValue={r.subject_key}>
                      {Object.entries(SUBJECTS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                    <input className="input py-1 text-sm md:col-span-2" name="subjectName" aria-label={`Subject ${i + 1} name`} defaultValue={r.subject_name} placeholder="Subject as printed" />
                    <input className="input py-1 text-sm" name="subjectMax" aria-label={`Subject ${i + 1} maximum marks`} defaultValue={r.max_marks ?? ''} placeholder="Max" inputMode="decimal" />
                    <input className="input py-1 text-sm" name="subjectObtained" aria-label={`Subject ${i + 1} marks obtained`} defaultValue={r.marks_obtained ?? ''} placeholder="Obtained" inputMode="decimal" />
                    <input className="input py-1 text-sm" name="subjectPct" aria-label={`Subject ${i + 1} percentage`} defaultValue={r.percentage ?? ''} placeholder="% (optional)" inputMode="decimal" />
                    <div className="flex gap-1">
                      <input className="input py-1 text-sm" name="subjectGrade" aria-label={`Subject ${i + 1} grade`} defaultValue={r.grade ?? ''} placeholder="Grade" />
                      <button type="button" className="btn-ghost btn-sm" aria-label={`Remove subject ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.k !== r.k))}>×</button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => setRows([...rows, { k: Date.now(), subject_key: 'other', subject_name: '', max_marks: '100', marks_obtained: '', percentage: '', grade: '' }])}>+ Add subject</button>
            </fieldset>
          )}
          {field('notes', 'Notes', v('notes'), { max: 2000 })}
          <SubmitButton>{initial?.id ? 'Save changes' : 'Add record'}</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}

export function EditRecord({ studentId, countries, kinds, initial }: { studentId: string; countries: Opt[]; kinds: string[]; initial: RecordFormValues }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit'}</button>
        <ActionForm action={deleteRecordAction.bind(null, studentId, initial.id!)} className="inline"><ConfirmSubmit className="btn-ghost btn-sm" confirmText="Remove this record?">Remove</ConfirmSubmit></ActionForm>
      </div>
      {open && <div className="mt-3 rounded-md bg-slate-50 p-3"><RecordForm studentId={studentId} countries={countries} kinds={kinds} initial={initial} onDone={() => setOpen(false)} /></div>}
    </div>
  )
}

export function NameCheckReview({ studentId, checkId, mandatory }: { studentId: string; checkId: string; mandatory: boolean }) {
  return (
    <ActionForm action={reviewNameCheckAction.bind(null, studentId, checkId)} className="mt-2 flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`nc-${checkId}`}>Note</label>
      <input id={`nc-${checkId}`} name="note" className="input min-w-56 flex-1 py-1 text-sm" placeholder={mandatory ? 'Note (optional)' : 'Note (required if no document is needed)'} />
      <SubmitButton name="decision" value="one_and_same" className="btn-secondary btn-sm">Require One and Same</SubmitButton>
      {!mandatory && <SubmitButton name="decision" value="no_action" className="btn-ghost btn-sm">Same person – no document needed</SubmitButton>}
    </ActionForm>
  )
}

export function OasActions({ studentId, caseId, templates, templateId, hasPreview, requested, canCancel }: {
  studentId: string; caseId: string; templates: Opt[]; templateId: string | null; hasPreview: boolean; requested: boolean; canCancel: boolean
}) {
  const [channel, setChannel] = useState('message')
  return (
    <div className="mt-2 space-y-2">
      {templates.length === 0 ? <p className="text-xs text-amber-800">No approved One and Same template yet (Admin → Academic & name rules).</p> : (
        <ActionForm action={prepareOasAction.bind(null, studentId, caseId)} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`tp-${caseId}`}>Template</label>
          <select id={`tp-${caseId}`} name="templateId" className="input w-auto py-1 text-sm" defaultValue={templateId ?? ''} required>
            <option value="" disabled>Choose an approved template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <SubmitButton className="btn-secondary btn-sm">{hasPreview ? 'Regenerate preview' : 'Generate preview'}</SubmitButton>
        </ActionForm>
      )}
      {hasPreview && (
        <ActionForm action={requestOasAction.bind(null, studentId, caseId)} className="flex flex-wrap items-center gap-2">
          <select name="channel" aria-label="How to request" className="input w-auto py-1 text-sm" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="message">Send by email/WhatsApp (message rules)</option><option value="manual">Record a manual request</option>
          </select>
          <input name="note" aria-label="Request note" className="input min-w-48 flex-1 py-1 text-sm" placeholder={channel === 'manual' ? 'How was the student contacted? (required)' : 'Note (optional)'} required={channel === 'manual'} />
          <SubmitButton className="btn-primary btn-sm">{requested ? 'Request again' : 'Request from student'}</SubmitButton>
        </ActionForm>
      )}
      {canCancel && (
        <details className="text-xs"><summary className="cursor-pointer text-slate-600">Cancel requirement (manager)…</summary>
          <ActionForm action={cancelOasAction.bind(null, studentId, caseId)} className="mt-1 flex flex-wrap items-center gap-2">
            <input name="reason" aria-label="Reason for cancelling" className="input min-w-56 flex-1 py-1 text-sm" placeholder="Reason (recorded)" required />
            <ConfirmSubmit className="btn-secondary btn-sm" confirmText="Cancel this One and Same requirement?">Cancel requirement</ConfirmSubmit>
          </ActionForm>
        </details>
      )}
    </div>
  )
}
