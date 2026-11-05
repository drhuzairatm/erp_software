'use client'

import { useState } from 'react'
import { clearPreferenceAction, savePreferenceAction } from '@/app/actions/preferences'
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/components/forms'

type Opt = { id: string; name: string }
export type PreferenceOptions = { countries: Opt[]; universities: (Opt & { country_id: string })[]; courses: Opt[]; intakes: (Opt & { university_id: string; course_id: string | null })[]; years: { id: string; code: string }[] }
type Values = { country_id?: string; university_id?: string | null; course_id?: string | null; intake_id?: string | null; academic_year_id?: string | null }

export function PreferenceForm({ studentId, rank, options, values }: { studentId: string; rank: number; options: PreferenceOptions; values?: Values }) {
  const p = `pref${rank}`
  const [country, setCountry] = useState(values?.country_id ?? '')
  const [uni, setUni] = useState(values?.university_id ?? '')
  const [course, setCourse] = useState(values?.course_id ?? '')
  const unis = options.universities.filter((u) => u.country_id === country)
  const intakes = options.intakes.filter((i) => i.university_id === uni && (!i.course_id || i.course_id === course))
  return (
    <ActionForm action={savePreferenceAction.bind(null, studentId, rank)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div><label className="label" htmlFor={`${p}-country`}>Country *</label><select className="input" id={`${p}-country`} name="countryId" required value={country} onChange={(e) => { setCountry(e.target.value); setUni('') }}><option value="">Choose</option>{options.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}-uni`}>University</label><select className="input" id={`${p}-uni`} name="universityId" value={uni} onChange={(e) => setUni(e.target.value)}><option value="">Undecided</option>{unis.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}-course`}>Programme</label><select className="input" id={`${p}-course`} name="courseId" value={course} onChange={(e) => setCourse(e.target.value)}><option value="">Undecided</option>{options.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}-intake`}>Intake</label><select key={`${uni}|${course}`} className="input" id={`${p}-intake`} name="intakeId" defaultValue={values?.intake_id ?? ''}><option value="">Undecided</option>{intakes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}-year`}>Academic year</label><select className="input" id={`${p}-year`} name="academicYearId" defaultValue={values?.academic_year_id ?? ''}><option value="">Undecided</option>{options.years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}</select></div>
      <div className="flex items-end"><SubmitButton className="btn-secondary">Save {rank === 2 ? 'secondary' : 'tertiary'} preference</SubmitButton></div>
    </ActionForm>
  )
}

export function ClearPreferenceButton({ studentId, rank }: { studentId: string; rank: number }) {
  return <ActionForm action={clearPreferenceAction.bind(null, studentId, rank)} className=""><ConfirmSubmit className="btn-ghost btn-sm" confirmText="Remove this preference? The history is kept.">Remove</ConfirmSubmit></ActionForm>
}
