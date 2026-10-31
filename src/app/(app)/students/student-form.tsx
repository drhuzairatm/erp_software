'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { ActionResult } from '@/components/action-types'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'
import type { DuplicateCandidate } from '@/server/services/students'

interface Opt { id: string; name: string }
export interface StudentFormProps {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>
  mode: 'create' | 'edit'
  registerOrgs: Opt[]
  organizations: Opt[]
  lookups: {
    countries: (Opt & { is_destination: boolean; is_education_origin: boolean })[]; courses: Opt[]; universities: (Opt & { country_id: string })[]
    campuses: (Opt & { university_id: string })[]
    leadSources: (Opt & { org_id: string })[]; legalEntities: Opt[]
  }
  counsellors?: (Opt & { org_id: string })[]
  contactEditable: boolean
  passportEditable: boolean
  canRecordConsent?: boolean
  initial?: Record<string, string | number | null | undefined>
  cancelHref: string
}

export function StudentForm(p: StudentFormProps) {
  const init = p.initial ?? {}
  const [org, setOrg] = useState(String(init.originatingOrgId ?? p.registerOrgs[0]?.id ?? ''))
  const [country, setCountry] = useState(String(init.destinationCountryId ?? ''))
  const [university, setUniversity] = useState(String(init.preferredUniversityId ?? ''))
  const destinations = p.lookups.countries.filter((c) => c.is_destination || c.id === init.destinationCountryId)
  // Previous-education countries first, then all others
  const originsFirst = [...p.lookups.countries].sort((a, b) => Number(b.is_education_origin) - Number(a.is_education_origin) || a.name.localeCompare(b.name))
  const campuses = p.lookups.campuses.filter((c) => c.university_id === university)
  const v = (k: string) => (init[k] == null ? '' : String(init[k]))
  const unis = p.lookups.universities.filter((u) => !country || u.country_id === country)

  return (
    <ActionForm action={p.action} className="space-y-6">
      {(s) => {
        const err = (k: string) => ({ 'aria-invalid': !!s.fieldErrors?.[k], 'aria-describedby': s.fieldErrors?.[k] ? `${k}-error` : undefined })
        const dups = (s.data?.duplicates as DuplicateCandidate[] | undefined) ?? []
        return (
          <>
            {dups.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
                <p className="font-medium">Possible duplicate records</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {dups.map((d, i) => (
                    <li key={i}>
                      {d.visible && d.student_id
                        ? <><Link href={`/students/${d.student_id}`} target="_blank">{d.student_code} – {d.full_name}</Link> ({d.org_name}), matched on {d.matched_on}</>
                        : <>A record in <strong>{d.org_name}</strong> matches on {d.matched_on}. You cannot view it; ask a manager to check and merge if it is the same person.</>}
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex items-center gap-2 font-medium">
                  <input type="checkbox" name="confirmDuplicate" value="yes" /> This is a different person / register anyway
                </label>
              </div>
            )}

            <fieldset className="card p-4">
              <legend className="px-1 text-sm font-semibold">Company and attribution</legend>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="label" htmlFor="originatingOrgId">Originating company / brand *</label>
                  {p.mode === 'create' ? (
                    <select className="input" id="originatingOrgId" name="originatingOrgId" value={org} onChange={(e) => setOrg(e.target.value)} {...err('originatingOrgId')}>
                      {p.registerOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  ) : (
                    <>
                      <input type="hidden" name="originatingOrgId" value={org} />
                      <p className="input bg-slate-100">{p.organizations.find((o) => o.id === org)?.name}</p>
                      <p className="hint">The originating brand cannot be changed after registration.</p>
                    </>
                  )}
                  <FieldError state={s} name="originatingOrgId" />
                </div>
                <div>
                  <label className="label" htmlFor="leadSourceId">Lead source</label>
                  <select className="input" id="leadSourceId" name="leadSourceId" defaultValue={v('leadSourceId')} key={org}>
                    <option value="">—</option>
                    {p.lookups.leadSources.filter((l) => l.org_id === org).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <FieldError state={s} name="leadSourceId" />
                </div>
                <div>
                  <label className="label" htmlFor="processingOrgId">Processing team</label>
                  <select className="input" id="processingOrgId" name="processingOrgId" defaultValue={v('processingOrgId')}>
                    <option value="">Same as originating company</option>
                    {p.organizations.filter((o) => o.id !== org).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <p className="hint">Gives that company&apos;s processing staff access for documentation and visa work.</p>
                </div>
                {p.mode === 'create' && p.counsellors && p.counsellors.length > 0 && (
                  <div>
                    <label className="label" htmlFor="counsellorId">Assigned counsellor</label>
                    <select className="input" id="counsellorId" name="counsellorId" defaultValue="">
                      <option value="">Me (if I am a counsellor)</option>
                      {p.counsellors.filter((c) => c.org_id === org).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="contractingEntityId">Contracting / legal entity</label>
                  <select className="input" id="contractingEntityId" name="contractingEntityId" defaultValue={v('contractingEntityId')}>
                    <option value="">Not yet decided</option>
                    {p.lookups.legalEntities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="paymentRecipientEntityId">Payment recipient</label>
                  <select className="input" id="paymentRecipientEntityId" name="paymentRecipientEntityId" defaultValue={v('paymentRecipientEntityId')}>
                    <option value="">Not yet decided</option>
                    {p.lookups.legalEntities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              </div>
            </fieldset>

            <fieldset className="card p-4">
              <legend className="px-1 text-sm font-semibold">Student details</legend>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                  <label className="label" htmlFor="fullName">Full name (as on passport) *</label>
                  <input className="input" id="fullName" name="fullName" defaultValue={v('fullName')} required maxLength={200} {...err('fullName')} />
                  <FieldError state={s} name="fullName" />
                </div>
                <div>
                  <label className="label" htmlFor="preferredLanguage">Preferred language</label>
                  <input className="input" id="preferredLanguage" name="preferredLanguage" defaultValue={v('preferredLanguage')} list="languages" maxLength={50} />
                  <datalist id="languages"><option value="English" /><option value="Malayalam" /><option value="Hindi" /><option value="Tamil" /><option value="Arabic" /></datalist>
                </div>
                {p.contactEditable ? (
                  <>
                    <div>
                      <label className="label" htmlFor="phone">Phone</label>
                      <input className="input" id="phone" name="phone" type="tel" defaultValue={v('phone')} placeholder="+91 …" {...err('phone')} />
                      <FieldError state={s} name="phone" />
                    </div>
                    <div>
                      <label className="label" htmlFor="email">Email</label>
                      <input className="input" id="email" name="email" type="email" defaultValue={v('email')} {...err('email')} />
                      <FieldError state={s} name="email" />
                    </div>
                    <div>
                      <label className="label" htmlFor="dateOfBirth">Date of birth</label>
                      <input className="input" id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={v('dateOfBirth')} {...err('dateOfBirth')} />
                      <p className="hint">Only if required for the application.</p>
                      <FieldError state={s} name="dateOfBirth" />
                    </div>
                  </>
                ) : (
                  <div className="md:col-span-3 text-sm text-slate-600">
                    Contact details are hidden for your role and will not be changed.
                  </div>
                )}
              </div>
            </fieldset>

            {p.contactEditable && (
              <fieldset className="card p-4">
                <legend className="px-1 text-sm font-semibold">Parent / guardian (optional)</legend>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div><label className="label" htmlFor="parentName">Parent name</label><input className="input" id="parentName" name="parentName" defaultValue={v('parentName')} maxLength={120} /></div>
                  <div><label className="label" htmlFor="parentPhone">Parent phone</label><input className="input" id="parentPhone" name="parentPhone" type="tel" defaultValue={v('parentPhone')} {...err('parentPhone')} /><FieldError state={s} name="parentPhone" /></div>
                  <div><label className="label" htmlFor="parentEmail">Parent email</label><input className="input" id="parentEmail" name="parentEmail" type="email" defaultValue={v('parentEmail')} {...err('parentEmail')} /><FieldError state={s} name="parentEmail" /></div>
                </div>
              </fieldset>
            )}

            {p.mode === 'create' && p.canRecordConsent && (
              <fieldset className="card p-4">
                <legend className="px-1 text-sm font-semibold">Agreed to receive updates by</legend>
                <p className="hint mb-2">Tick only what the student / parent has actually agreed to. Messages are never sent without consent. Consent can be withdrawn at any time on the student&apos;s Messages tab.</p>
                <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                  {(['student', 'parent'] as const).map((who) => (
                    <div key={who} className="flex flex-wrap gap-4"><span className="w-16 font-medium capitalize">{who}</span>
                      {(['email', 'whatsapp', 'sms'] as const).map((ch) => (
                        <label key={ch} className="flex items-center gap-1"><input type="checkbox" name={`consent.${who}.${ch}`} value="yes" /> {ch === 'whatsapp' ? 'WhatsApp' : ch === 'sms' ? 'SMS' : 'Email'}</label>
                      ))}
                    </div>
                  ))}
                </div>
              </fieldset>
            )}

            <fieldset className="card p-4">
              <legend className="px-1 text-sm font-semibold">Programme</legend>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="label" htmlFor="destinationCountryId">Destination country</label>
                  <select className="input" id="destinationCountryId" name="destinationCountryId" value={country} onChange={(e) => setCountry(e.target.value)}>
                    <option value="">—</option>
                    {destinations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="courseId">Course</label>
                  <select className="input" id="courseId" name="courseId" defaultValue={v('courseId')}>
                    <option value="">—</option>
                    {p.lookups.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="preferredUniversityId">Preferred university</label>
                  <select className="input" id="preferredUniversityId" name="preferredUniversityId" value={unis.some((u) => u.id === university) ? university : ''}
                    onChange={(e) => setUniversity(e.target.value)} {...err('preferredUniversityId')}>
                    <option value="">—</option>
                    {unis.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <FieldError state={s} name="preferredUniversityId" />
                </div>
                {campuses.length > 0 && (
                  <div>
                    <label className="label" htmlFor="preferredCampusId">Campus</label>
                    <select className="input" id="preferredCampusId" name="preferredCampusId" defaultValue={v('preferredCampusId')} key={university}>
                      <option value="">—</option>
                      {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <FieldError state={s} name="preferredCampusId" />
                  </div>
                )}
              </div>
              <div className="mt-4 max-w-sm">
                <label className="label" htmlFor="visaApplicationCountryId">Visa application country</label>
                <select className="input" id="visaApplicationCountryId" name="visaApplicationCountryId" defaultValue={v('visaApplicationCountryId')}>
                  <option value="">Not yet known</option>{originsFirst.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="hint">Where the student will apply for the visa (decides PCC and visa-document routes). Not the same as nationality or residence.</p>
              </div>
              <p className="hint mt-2">Country and course determine the workflow stages; the university adds its own required documents.</p>
            </fieldset>

            <fieldset className="card p-4">
              <legend className="px-1 text-sm font-semibold">Previous education and academic information</legend>
              <p className="hint mb-3">Where the student studied before — separate from the destination country. It decides which wording certificates must contain.</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="label" htmlFor="previousEducationCountryId">Previous education country</label>
                  <select className="input" id="previousEducationCountryId" name="previousEducationCountryId" defaultValue={v('previousEducationCountryId')}>
                    <option value="">—</option>{originsFirst.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="schoolCountryId">School / institution country</label>
                  <select className="input" id="schoolCountryId" name="schoolCountryId" defaultValue={v('schoolCountryId')}>
                    <option value="">Same as previous education country</option>{originsFirst.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="institutionName">School / institution name</label>
                  <input className="input" id="institutionName" name="institutionName" defaultValue={v('institutionName')} maxLength={200} />
                </div>
                <TextField name="highestQualification" label="Highest qualification" v={v} />
                <TextField name="qualificationBoard" label="Board / university" v={v} />
                <div>
                  <label className="label" htmlFor="qualificationYear">Year of passing</label>
                  <input className="input" id="qualificationYear" name="qualificationYear" type="number" min={1970} max={2100} defaultValue={v('qualificationYear')} {...err('qualificationYear')} />
                  <FieldError state={s} name="qualificationYear" />
                </div>
                <TextField name="qualificationScore" label="Score / percentage" v={v} />
                <TextField name="entranceExam" label="Entrance / language exam" v={v} />
                <TextField name="entranceScore" label="Exam score" v={v} />
                <div className="md:col-span-3">
                  <label className="label" htmlFor="academicNotes">Academic notes</label>
                  <textarea className="input" id="academicNotes" name="academicNotes" rows={2} defaultValue={v('academicNotes')} maxLength={2000} />
                </div>
              </div>
            </fieldset>

            {p.passportEditable && (
              <fieldset className="card p-4">
                <legend className="px-1 text-sm font-semibold">Passport</legend>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="label" htmlFor="passportNumber">Passport number</label>
                    <input className="input font-mono uppercase" id="passportNumber" name="passportNumber" defaultValue={v('passportNumber')} maxLength={20} autoComplete="off" {...err('passportNumber')} />
                    <FieldError state={s} name="passportNumber" />
                  </div>
                  <div>
                    <label className="label" htmlFor="passportExpiry">Expiry date</label>
                    <input className="input" id="passportExpiry" name="passportExpiry" type="date" defaultValue={v('passportExpiry')} {...err('passportExpiry')} />
                    <FieldError state={s} name="passportExpiry" />
                  </div>
                  <div>
                    <label className="label" htmlFor="passportCountryId">Issuing country (nationality)</label>
                    <select className="input" id="passportCountryId" name="passportCountryId" defaultValue={v('passportCountryId')}>
                      <option value="">—</option>{originsFirst.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <p className="hint mt-2">Visible only to roles with passport permission. Never upload passport scans here — use the Documents tab.</p>
              </fieldset>
            )}

            <fieldset className="card p-4">
              <legend className="px-1 text-sm font-semibold">Registration and next step</legend>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="label" htmlFor="registrationDate">Registration date</label>
                  <input className="input" id="registrationDate" name="registrationDate" type="date" defaultValue={v('registrationDate')} />
                </div>
                <div>
                  <label className="label" htmlFor="nextAction">Next action</label>
                  <input className="input" id="nextAction" name="nextAction" defaultValue={v('nextAction')} maxLength={300} placeholder="e.g. Collect passport copy" />
                </div>
                <div>
                  <label className="label" htmlFor="nextActionDue">Next action due</label>
                  <input className="input" id="nextActionDue" name="nextActionDue" type="date" defaultValue={v('nextActionDue')} />
                </div>
              </div>
            </fieldset>

            <div className="flex gap-2">
              <SubmitButton>{p.mode === 'create' ? 'Register student' : 'Save changes'}</SubmitButton>
              <Link href={p.cancelHref} className="btn-secondary">Cancel</Link>
            </div>
          </>
        )
      }}
    </ActionForm>
  )
}

function TextField({ name, label, v }: { name: string; label: string; v: (k: string) => string }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input className="input" id={name} name={name} defaultValue={v(name)} maxLength={120} />
    </div>
  )
}
