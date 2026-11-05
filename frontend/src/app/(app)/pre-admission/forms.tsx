'use client'

import { useState } from 'react'
import { addDvrDocumentsAction, assignDvrAction, cancelDvrAction, closeDvrAction, completeDvrAction, createDvrAction, linkDvrStudentAction, removeDvrDocumentAction, requestDvrDocumentAction, returnDvrAction, reviewDvrDocumentAction, sendBackDvrAction, startDvrAction, submitDvrAction, updateDvrAction, uploadDvrVersionAction } from '@/app/actions/dvr'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

type Opt = { id: string; name: string }
export type DvrFormOptions = { orgs: Opt[]; countries: (Opt & { is_destination: boolean })[]; universities: (Opt & { country_id: string })[]; courses: Opt[]; intakes: string[]; documentTypes: string[] }
type Values = { prospect_name?: string; prospect_phone?: string | null; prospect_email?: string | null; destination_country_id?: string; university_id?: string | null; university_text?: string | null; course_id?: string | null; programme_text?: string | null; intake?: string | null; academic_year?: string | null; remarks?: string | null; special_instructions?: string | null }

const RESULTS: [string, string][] = [['verified', 'Verified'], ['not_acceptable', 'Not acceptable'], ['correction_required', 'Correction required'], ['missing_document', 'Missing document'], ['additional_clarification_required', 'Additional clarification required']]
const OVERALL: [string, string][] = [['possible', 'Possible'], ['possible_with_conditions', 'Possible with conditions'], ['not_possible', 'Not possible'], ['pending_further_review', 'Pending further review']]
const TEN_MB = 10 * 1024 * 1024

function RequestFields({ o, v }: { o: DvrFormOptions; v: Values }) {
  const [country, setCountry] = useState(v.destination_country_id ?? '')
  const unis = o.universities.filter((u) => u.country_id === country)
  const dest = o.countries.filter((c) => c.is_destination || c.id === v.destination_country_id)
  return (<>
    <div className="md:col-span-2"><label className="label" htmlFor="d-name">Name of prospective student *</label><input className="input" id="d-name" name="prospectName" defaultValue={v.prospect_name} required maxLength={150} /></div>
    <div><label className="label" htmlFor="d-phone">Phone</label><input className="input" id="d-phone" name="prospectPhone" type="tel" defaultValue={v.prospect_phone ?? ''} maxLength={40} /></div>
    <div><label className="label" htmlFor="d-email">Email</label><input className="input" id="d-email" name="prospectEmail" type="email" defaultValue={v.prospect_email ?? ''} maxLength={200} /><p className="hint">A phone number or an email address is required.</p></div>
    <div><label className="label" htmlFor="d-country">Destination country *</label><select className="input" id="d-country" name="countryId" value={country} onChange={(e) => setCountry(e.target.value)} required><option value="">Choose</option>{dest.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    <div><label className="label" htmlFor="d-uni">Target university</label><select key={country} className="input" id="d-uni" name="universityId" defaultValue={v.university_id ?? ''}><option value="">Not in the list or undecided</option>{unis.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
    <div><label className="label" htmlFor="d-unit">University, if not in the list</label><input className="input" id="d-unit" name="universityText" defaultValue={v.university_text ?? ''} maxLength={200} /></div>
    <div><label className="label" htmlFor="d-course">Programme</label><select className="input" id="d-course" name="courseId" defaultValue={v.course_id ?? ''}><option value="">Not in the list or undecided</option>{o.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    <div><label className="label" htmlFor="d-prog">Programme, if not in the list</label><input className="input" id="d-prog" name="programmeText" defaultValue={v.programme_text ?? ''} maxLength={200} /></div>
    <div><label className="label" htmlFor="d-intake">Intake</label><input className="input" id="d-intake" name="intake" list="d-intakes" defaultValue={v.intake ?? ''} maxLength={80} /><datalist id="d-intakes">{o.intakes.map((i) => <option key={i} value={i} />)}</datalist></div>
    <div><label className="label" htmlFor="d-year">Academic year</label><input className="input" id="d-year" name="academicYear" defaultValue={v.academic_year ?? ''} maxLength={20} placeholder="2027-28" /></div>
    <div className="md:col-span-2"><label className="label" htmlFor="d-remarks">Remarks</label><textarea className="input" id="d-remarks" name="remarks" rows={3} defaultValue={v.remarks ?? ''} maxLength={4000} /></div>
    <div className="md:col-span-2"><label className="label" htmlFor="d-special">Special instructions for Documentation</label><textarea className="input" id="d-special" name="specialInstructions" rows={3} defaultValue={v.special_instructions ?? ''} maxLength={4000} /></div>
  </>)
}

export function NewDvrForm({ options }: { options: DvrFormOptions }) {
  return (
    <ActionForm action={createDvrAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {(s) => (<>
        <div className="md:col-span-2"><label className="label" htmlFor="d-org">Company</label><select className="input" id="d-org" name="orgId" defaultValue={options.orgs[0]?.id}>{options.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select><FieldError state={s} name="orgId" /></div>
        <RequestFields o={options} v={{}} />
        <p className="hint md:col-span-2">This does not register a student. No Student ID, student profile, portal account or admission application is created.</p>
        <div className="md:col-span-2"><SubmitButton>Save and add documents</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}

export function EditDvrForm({ id, options, values }: { id: string; options: DvrFormOptions; values: Values }) {
  return <ActionForm action={updateDvrAction.bind(null, id)} className="grid grid-cols-1 gap-3 md:grid-cols-2"><RequestFields o={options} v={values} /><div className="md:col-span-2"><SubmitButton className="btn-secondary">Save details</SubmitButton></div></ActionForm>
}

export function AddDocumentsForm({ id, documentTypes }: { id: string; documentTypes: string[] }) {
  const [tooBig, setTooBig] = useState(false)
  return (
    <ActionForm action={addDvrDocumentsAction.bind(null, id)} resetOnSuccess className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div><label className="label" htmlFor="doc-cat">Document category *</label><input className="input" id="doc-cat" name="category" list="doc-cats" required maxLength={120} /><datalist id="doc-cats">{documentTypes.map((d) => <option key={d} value={d} />)}</datalist></div>
      <div><label className="label" htmlFor="doc-label">Description</label><input className="input" id="doc-label" name="label" maxLength={200} /></div>
      <div className="md:col-span-2"><label className="label" htmlFor="doc-files">PDF files *</label><input className="input" id="doc-files" name="files" type="file" accept="application/pdf,.pdf" multiple required onChange={(e) => setTooBig(Array.from(e.target.files ?? []).reduce((n, f) => n + f.size, 0) > TEN_MB)} />
        <p className={tooBig ? 'mt-1 text-sm text-red-700' : 'hint'}>{tooBig ? 'These files are over 10 MB together. Upload them in smaller groups.' : 'Up to 10 PDFs and 10 MB at a time. Each file becomes its own document for review.'}</p></div>
      <div className="md:col-span-2">{tooBig ? <button type="button" className="btn-secondary" disabled>Add documents</button> : <SubmitButton className="btn-secondary" pendingText="Uploading…">Add documents</SubmitButton>}</div>
    </ActionForm>
  )
}

export function NewVersionForm({ id, documentId, required }: { id: string; documentId: string; required: boolean }) {
  return (
    <ActionForm action={uploadDvrVersionAction.bind(null, id, documentId)} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1"><label className="label" htmlFor={`v-${documentId}`}>{required ? 'Upload the corrected PDF' : 'Upload a new version (PDF)'}</label><input className="input" id={`v-${documentId}`} name="file" type="file" accept="application/pdf,.pdf" required /></div>
      <SubmitButton className="btn-secondary" pendingText="Uploading…">Upload version</SubmitButton>
    </ActionForm>
  )
}

export function RemoveDocumentButton({ id, documentId }: { id: string; documentId: string }) {
  return <ActionForm action={removeDvrDocumentAction.bind(null, id, documentId)} className=""><ConfirmSubmit className="btn-secondary" confirmText="Remove this document from the request?">Remove</ConfirmSubmit></ActionForm>
}

export function ReviewDocumentForm({ id, documentId, current, label }: { id: string; documentId: string; current: string | null; label: string }) {
  return (
    <ActionForm action={reviewDvrDocumentAction.bind(null, id, documentId)} className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-end">
      <div><label className="label" htmlFor={`r-${documentId}`}>Result for {label}</label><select className="input" id={`r-${documentId}`} name="result" defaultValue={current ?? ''} required><option value="">Choose</option>{RESULTS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
      <div><label className="label" htmlFor={`n-${documentId}`}>Notes for the counsellor</label><input className="input" id={`n-${documentId}`} name="notes" maxLength={2000} /></div>
      <SubmitButton className="btn-secondary">Save result</SubmitButton>
    </ActionForm>
  )
}

export function AssignForm({ id, reviewers, current, withReason }: { id: string; reviewers: { id: string; full_name: string }[]; current: string | null; withReason: boolean }) {
  return (
    <ActionForm action={assignDvrAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1"><label className="label" htmlFor="a-rev">{current ? 'Reassign to' : 'Assign to'}</label><select className="input" id="a-rev" name="reviewer" defaultValue={current ?? ''} required><option value="">Choose a reviewer</option>{reviewers.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}</select></div>
      {withReason && <div className="min-w-0 flex-1"><label className="label" htmlFor="a-why">Reason for reassigning</label><input className="input" id="a-why" name="reason" maxLength={500} /></div>}
      <SubmitButton className="btn-secondary">Save reviewer</SubmitButton>
    </ActionForm>
  )
}

export function StartButton({ id }: { id: string }) {
  return <ActionForm action={startDvrAction.bind(null, id)} className=""><SubmitButton pendingText="Starting…">Start verification</SubmitButton></ActionForm>
}

export function SubmitForm({ id, resubmit }: { id: string; resubmit: boolean }) {
  return (
    <ActionForm action={submitDvrAction.bind(null, id)} className="space-y-2">
      <div><label className="label" htmlFor="s-note">Note for Documentation</label><textarea className="input" id="s-note" name="note" rows={2} maxLength={2000} /></div>
      <SubmitButton>{resubmit ? 'Resubmit to Documentation' : 'Submit to Documentation'}</SubmitButton>
    </ActionForm>
  )
}

export function RequestDocumentForm({ id, documentTypes }: { id: string; documentTypes: string[] }) {
  return (
    <ActionForm action={requestDvrDocumentAction.bind(null, id)} resetOnSuccess className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-end">
      <div><label className="label" htmlFor="q-cat">Missing document</label><input className="input" id="q-cat" name="category" list="q-cats" required maxLength={120} /><datalist id="q-cats">{documentTypes.map((d) => <option key={d} value={d} />)}</datalist></div>
      <div><label className="label" htmlFor="q-notes">What is needed</label><input className="input" id="q-notes" name="notes" required maxLength={2000} /></div>
      <SubmitButton className="btn-secondary">Record as missing</SubmitButton>
    </ActionForm>
  )
}

export function SendBackForm({ id }: { id: string }) {
  return (
    <ActionForm action={sendBackDvrAction.bind(null, id)} className="space-y-2">
      <div><label className="label" htmlFor="b-status">Next step</label><select className="input" id="b-status" name="status" required defaultValue="additional_documents_required"><option value="additional_documents_required">Additional documents required</option><option value="correction_required">Correction required</option><option value="pending_further_review">Pending further review (stays with Documentation)</option></select></div>
      <div><label className="label" htmlFor="b-note">Note *</label><textarea className="input" id="b-note" name="note" rows={2} required maxLength={2000} /></div>
      <SubmitButton className="btn-secondary">Save next step</SubmitButton>
    </ActionForm>
  )
}

export function CompleteForm({ id, current, notes }: { id: string; current: string | null; notes: string | null }) {
  return (
    <ActionForm action={completeDvrAction.bind(null, id)} className="space-y-2">
      <div><label className="label" htmlFor="c-overall">Overall assessment *</label><select className="input" id="c-overall" name="overall" required defaultValue={current ?? ''}><option value="">Choose</option>{OVERALL.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
      <div><label className="label" htmlFor="c-notes">Explanation (required unless Possible)</label><textarea className="input" id="c-notes" name="notes" rows={3} defaultValue={notes ?? ''} maxLength={4000} /></div>
      <p className="hint">A preliminary assessment only: never a guarantee of admission or a visa.</p>
      <SubmitButton>Record assessment</SubmitButton>
    </ActionForm>
  )
}

export function ReturnForm({ id }: { id: string }) {
  return (
    <ActionForm action={returnDvrAction.bind(null, id)} className="space-y-2">
      <div><label className="label" htmlFor="t-note">Note for the counsellor</label><textarea className="input" id="t-note" name="note" rows={2} maxLength={2000} /></div>
      <SubmitButton>Return to counsellor</SubmitButton>
    </ActionForm>
  )
}

export function CloseForm({ id }: { id: string }) {
  return <ActionForm action={closeDvrAction.bind(null, id)} className=""><input type="hidden" name="note" value="" /><ConfirmSubmit className="btn-secondary" confirmText="Close this request? It can no longer be changed.">Close request</ConfirmSubmit></ActionForm>
}

export function CancelForm({ id }: { id: string }) {
  return (
    <ActionForm action={cancelDvrAction.bind(null, id)} className="space-y-2">
      <div><label className="label" htmlFor="x-reason">Reason for cancelling</label><input className="input" id="x-reason" name="reason" required maxLength={500} /></div>
      <ConfirmSubmit confirmText="Cancel this request? It can no longer be changed.">Cancel request</ConfirmSubmit>
    </ActionForm>
  )
}

export function LinkStudentForm({ id }: { id: string }) {
  return (
    <ActionForm action={linkDvrStudentAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1"><label className="label" htmlFor="l-code">Student ID of the registered student</label><input className="input" id="l-code" name="studentCode" required maxLength={40} /></div>
      <SubmitButton className="btn-secondary">Link student</SubmitButton>
    </ActionForm>
  )
}
