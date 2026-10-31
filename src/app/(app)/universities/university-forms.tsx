'use client'

import { addPartAction, removeRequirementAction, saveUniversityAction, togglePartAction } from '@/app/actions/universities'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

type Opt = { value: string; label: string }

export function UniversityForm({ id, countries, initial }: { id: string | null; countries: Opt[]; initial?: { name: string; city: string | null; website: string | null; notes: string | null; is_active: boolean } }) {
  return (
    <ActionForm action={saveUniversityAction.bind(null, id)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {(s) => (
        <>
          {!id && (
            <div><label className="label" htmlFor="countryId">Country</label>
              <select className="input" id="countryId" name="countryId" required defaultValue="">
                <option value="" disabled>Choose…</option>{countries.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select><FieldError state={s} name="countryId" /></div>
          )}
          <div><label className="label" htmlFor="name">University name</label><input className="input" id="name" name="name" required defaultValue={initial?.name} /><FieldError state={s} name="name" /></div>
          <div><label className="label" htmlFor="city">City</label><input className="input" id="city" name="city" defaultValue={initial?.city ?? ''} /></div>
          <div><label className="label" htmlFor="website">Website</label><input className="input" id="website" name="website" type="url" placeholder="https://" defaultValue={initial?.website ?? ''} /><FieldError state={s} name="website" /></div>
          <div className="md:col-span-2"><label className="label" htmlFor="notes">Notes</label><textarea className="input" id="notes" name="notes" rows={2} defaultValue={initial?.notes ?? ''} /></div>
          {id && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" value="no" defaultChecked={initial ? !initial.is_active : false} /> Deactivated (hidden from new students)</label>
          )}
          <div className="md:col-span-2"><SubmitButton>{id ? 'Save details' : 'Add university'}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function AddCampusForm({ universityId }: { universityId: string }) {
  return (
    <ActionForm action={addPartAction.bind(null, universityId, 'campus')} className="flex flex-wrap items-end gap-2" resetOnSuccess>
      <div><label className="label text-xs" htmlFor="campus-name">Campus</label><input className="input py-1.5" id="campus-name" name="name" required /></div>
      <div><label className="label text-xs" htmlFor="campus-city">City</label><input className="input py-1.5" id="campus-city" name="city" /></div>
      <SubmitButton className="btn-secondary btn-sm">Add campus</SubmitButton>
    </ActionForm>
  )
}

export function AddCourseForm({ universityId, courses }: { universityId: string; courses: Opt[] }) {
  return (
    <ActionForm action={addPartAction.bind(null, universityId, 'course')} className="grid grid-cols-1 gap-2 md:grid-cols-4" resetOnSuccess>
      <div><label className="label text-xs" htmlFor="uc-course">Course</label><select className="input py-1.5" id="uc-course" name="courseId" required>{courses.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
      <div><label className="label text-xs" htmlFor="uc-years">Duration (years)</label><input className="input py-1.5" id="uc-years" name="durationYears" inputMode="decimal" placeholder="6" /></div>
      <div><label className="label text-xs" htmlFor="uc-medium">Medium</label><input className="input py-1.5" id="uc-medium" name="medium" placeholder="English" /></div>
      <div className="md:col-span-4"><label className="label text-xs" htmlFor="uc-elig">Admission requirements / eligibility</label><textarea className="input py-1.5" id="uc-elig" name="eligibility" rows={2} placeholder="e.g. Plus Two with 50% in PCB; NEET qualified" /></div>
      <div><SubmitButton className="btn-secondary btn-sm">Save course</SubmitButton></div>
    </ActionForm>
  )
}

export function AddIntakeForm({ universityId, courses }: { universityId: string; courses: Opt[] }) {
  return (
    <ActionForm action={addPartAction.bind(null, universityId, 'intake')} className="grid grid-cols-1 gap-2 md:grid-cols-5" resetOnSuccess>
      <div><label className="label text-xs" htmlFor="in-name">Intake</label><input className="input py-1.5" id="in-name" name="name" placeholder="September 2027" required /></div>
      <div><label className="label text-xs" htmlFor="in-course">Course</label><select className="input py-1.5" id="in-course" name="courseId" defaultValue=""><option value="">All courses</option>{courses.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
      <div><label className="label text-xs" htmlFor="in-deadline">Application deadline</label><input className="input py-1.5" id="in-deadline" name="applicationDeadline" type="date" /></div>
      <div><label className="label text-xs" htmlFor="in-start">Classes start</label><input className="input py-1.5" id="in-start" name="startsOn" type="date" /></div>
      <div className="flex items-end"><SubmitButton className="btn-secondary btn-sm">Add intake</SubmitButton></div>
    </ActionForm>
  )
}

export function AddRequirementForm({ universityId, courses, documentTypes }: { universityId: string; courses: Opt[]; documentTypes: Opt[] }) {
  return (
    <ActionForm action={addPartAction.bind(null, universityId, 'requirement')} className="grid grid-cols-1 gap-2 md:grid-cols-5" resetOnSuccess>
      <div><label className="label text-xs" htmlFor="rq-doc">Document</label><select className="input py-1.5" id="rq-doc" name="documentTypeId" required>{documentTypes.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
      <div><label className="label text-xs" htmlFor="rq-course">For course</label><select className="input py-1.5" id="rq-course" name="courseId" defaultValue=""><option value="">All courses</option>{courses.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
      <div className="md:col-span-2"><label className="label text-xs" htmlFor="rq-notes">Notes</label><input className="input py-1.5" id="rq-notes" name="notes" placeholder="e.g. must be apostilled" /></div>
      <label className="flex items-end gap-2 pb-2 text-xs"><input type="checkbox" name="required" value="no" /> Optional</label>
      <div><SubmitButton className="btn-secondary btn-sm">Add requirement</SubmitButton></div>
    </ActionForm>
  )
}

export function TogglePart({ universityId, part, id, active }: { universityId: string; part: 'campus' | 'course' | 'intake'; id: string; active: boolean }) {
  return (
    <ActionForm action={togglePartAction.bind(null, universityId, part, id, !active)} className="inline">
      <SubmitButton className="btn-ghost btn-sm" pendingText="…">{active ? 'Deactivate' : 'Activate'}</SubmitButton>
    </ActionForm>
  )
}

export function RemoveRequirement({ universityId, id }: { universityId: string; id: string }) {
  return (
    <ActionForm action={removeRequirementAction.bind(null, universityId, id)} className="inline">
      <ConfirmSubmit className="btn-ghost btn-sm" confirmText="Remove for future checklists?">Remove</ConfirmSubmit>
    </ActionForm>
  )
}
