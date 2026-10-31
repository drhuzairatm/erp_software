'use client'

import { useState } from 'react'
import { passportFollowupAction, recordPassportAction, sendEmailVerificationAction } from '@/app/actions/passport'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'

type Opt = { id: string; name: string }

export function RecordPassportForm({ studentId, countries, current }: {
  studentId: string; countries: Opt[]
  current: { holder_name: string | null; date_of_birth: string | null; gender: string | null; nationality_country_id: string | null; citizenship_country_id: string | null; issuing_country_id: string | null } | null
}) {
  const [kind, setKind] = useState(current ? 'renewal' : 'initial')
  const cs = (name: string, text: string, def?: string | null) => (
    <div><label className="label" htmlFor={`pp-${name}`}>{text}</label>
      <select className="input" id={`pp-${name}`} name={name} defaultValue={def ?? ''}><option value="">—</option>{countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
  )
  return (
    <ActionForm action={recordPassportAction.bind(null, studentId)} className="space-y-4" resetOnSuccess>
      {(s) => (
        <>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 text-sm font-medium">What are you recording?</legend>
            {(current ? [['renewal', 'A renewed (new) passport'], ['correction', 'A correction to the current passport']] : [['initial', 'The current passport']]).map(([k, t]) => (
              <label key={k} className="flex items-center gap-1"><input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} /> {t}</label>))}
          </fieldset>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><label className="label" htmlFor="pp-number">Passport number *</label>
              <input className="input font-mono uppercase" id="pp-number" name="passportNumber" required maxLength={20} autoComplete="off" /><FieldError state={s} name="passportNumber" /></div>
            <div className="md:col-span-2"><label className="label" htmlFor="pp-holder">Holder name exactly as printed</label>
              <input className="input" id="pp-holder" name="holderName" maxLength={200} defaultValue={current?.holder_name ?? ''} autoComplete="off" /></div>
            <div><label className="label" htmlFor="pp-dob">Date of birth (passport)</label><input className="input" id="pp-dob" name="dateOfBirth" type="date" defaultValue={current?.date_of_birth ?? ''} /></div>
            <div><label className="label" htmlFor="pp-gender">Gender (passport)</label>
              <select className="input" id="pp-gender" name="gender" defaultValue={current?.gender ?? ''}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="unspecified">Unspecified / X</option></select></div>
            {cs('nationalityCountryId', 'Nationality', current?.nationality_country_id)}
            {cs('citizenshipCountryId', 'Country of citizenship', current?.citizenship_country_id)}
            {cs('issuingCountryId', 'Issuing country', current?.issuing_country_id)}
            <div><label className="label" htmlFor="pp-place">Place of issue</label><input className="input" id="pp-place" name="placeOfIssue" maxLength={120} /></div>
            <div><label className="label" htmlFor="pp-issue">Issue date</label><input className="input" id="pp-issue" name="issueDate" type="date" /><FieldError state={s} name="issueDate" /></div>
            <div><label className="label" htmlFor="pp-expiry">Expiry date *</label><input className="input" id="pp-expiry" name="expiryDate" type="date" required /><FieldError state={s} name="expiryDate" /></div>
            <div className="md:col-span-3"><label className="label" htmlFor="pp-notes">Notes{kind === 'correction' && ' * (what is being corrected)'}</label>
              <input className="input" id="pp-notes" name="notes" maxLength={2000} required={kind === 'correction'} /></div>
          </div>
          <p className="hint">Nothing is overwritten: this becomes a new passport version and the previous details stay in the history.
            Upload the passport scan on the Documents tab (Passport item).</p>
          <SubmitButton>{kind === 'renewal' ? 'Record renewed passport' : kind === 'correction' ? 'Record correction' : 'Record passport'}</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}

export function PassportFollowupForm({ studentId }: { studentId: string }) {
  const [kind, setKind] = useState('contact')
  return (
    <ActionForm action={passportFollowupAction.bind(null, studentId)} className="grid grid-cols-1 gap-2 md:grid-cols-4" resetOnSuccess>
      {(s) => (
        <>
          <div><label className="label text-xs" htmlFor="pf-kind">Type</label>
            <select className="input py-1.5" id="pf-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="contact">Contacted student</option><option value="commitment">Renewal commitment</option><option value="remark">Remark</option><option value="received">Renewed passport received</option>
            </select></div>
          <div className="md:col-span-2"><label className="label text-xs" htmlFor="pf-note">Note</label><input className="input py-1.5" id="pf-note" name="note" required maxLength={2000} /><FieldError state={s} name="note" /></div>
          <div><label className="label text-xs" htmlFor="pf-date">Expected date{kind === 'commitment' && ' *'}</label>
            <input className="input py-1.5" id="pf-date" name="expectedDate" type="date" required={kind === 'commitment'} /><FieldError state={s} name="expectedDate" /></div>
          <div className="md:col-span-4"><SubmitButton className="btn-secondary btn-sm">Add</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function VerifyEmailButton({ studentId, again }: { studentId: string; again: boolean }) {
  return (
    <ActionForm action={sendEmailVerificationAction.bind(null, studentId)} className="mt-1">
      <SubmitButton className="btn-ghost btn-sm">{again ? 'Resend verification email' : 'Send verification email'}</SubmitButton>
    </ActionForm>
  )
}
