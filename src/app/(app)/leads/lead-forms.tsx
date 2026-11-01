'use client'

import { useState } from 'react'
import { convertLeadAction, createLeadAction, duplicateAction, importLeadsAction, leadWorkAction, routeLeadAction, updateLeadAction } from '@/app/actions/leads'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'
import { PhoneField } from '@/components/phone-field'

type Opt = { value: string; label: string }
const PROGRAMMES: Opt[] = [['mbbs', 'MBBS'], ['nursing', 'Nursing'], ['medical_pg', 'Medical PG'], ['bachelors', "Bachelor's"], ['general_pg', 'General PG'], ['other', 'Other'], ['not_sure', 'Not sure yet']]
  .map(([value, label]) => ({ value, label }))
const STATUSES: Opt[] = [['new', 'New'], ['contacted', 'Contacted'], ['interested', 'Interested'], ['not_interested', 'Not interested'], ['closed', 'Closed'], ['invalid', 'Invalid']]
  .map(([value, label]) => ({ value, label }))

function Sel({ name, label, opts, value, any = '—' }: { name: string; label: string; opts: Opt[]; value?: string | null; any?: string }) {
  return (
    <div><label className="label" htmlFor={`l-${name}`}>{label}</label>
      <select className="input" id={`l-${name}`} name={name} defaultValue={value ?? ''}><option value="">{any}</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
  )
}

export interface LeadFormOptions { orgs: Opt[]; countries: Opt[]; courses: Opt[]; canCentral: boolean }
type LeadValues = Partial<Record<'full_name' | 'phone' | 'whatsapp' | 'email' | 'residence_country_id' | 'destination_country_id' | 'course_id' | 'programme' | 'qualification' | 'preferred_company' | 'remarks', string | null>>

function Fields({ o, v }: { o: LeadFormOptions; v?: LeadValues }) {
  return (
    <>
      <div className="md:col-span-2"><label className="label" htmlFor="l-fullName">Name *</label><input className="input" id="l-fullName" name="fullName" required defaultValue={v?.full_name ?? ''} /></div>
      <PhoneField name="phone" label="Mobile number" defaultValue={v?.phone ?? ''} />
      <div><label className="label" htmlFor="l-whatsapp">WhatsApp (if different)</label><input className="input" id="l-whatsapp" name="whatsapp" defaultValue={v?.whatsapp ?? ''} /></div>
      <div><label className="label" htmlFor="l-email">Email</label><input className="input" id="l-email" name="email" type="email" defaultValue={v?.email ?? ''} /></div>
      <Sel name="programme" label="Course / programme" opts={PROGRAMMES} value={v?.programme} />
      <Sel name="courseId" label="Course (if known)" opts={o.courses} value={v?.course_id} />
      <Sel name="destinationCountryId" label="Destination country" opts={o.countries} value={v?.destination_country_id} />
      <Sel name="residenceCountryId" label="Country of residence" opts={o.countries} value={v?.residence_country_id} />
      <div><label className="label" htmlFor="l-qual">Qualification</label><input className="input" id="l-qual" name="qualification" defaultValue={v?.qualification ?? ''} /></div>
      <div><label className="label" htmlFor="l-pref">Preferred company</label><input className="input" id="l-pref" name="preferredCompany" defaultValue={v?.preferred_company ?? ''} /></div>
      <div className="md:col-span-3"><label className="label" htmlFor="l-remarks">Remarks</label><textarea className="input min-h-20" id="l-remarks" name="remarks" defaultValue={v?.remarks ?? ''} /></div>
    </>
  )
}

export function NewLeadForm({ o }: { o: LeadFormOptions }) {
  return (
    <ActionForm action={createLeadAction} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {(s) => (
        <>
          <div><label className="label" htmlFor="l-org">Company *</label>
            <select className="input" id="l-org" name="orgId" required defaultValue={o.orgs.length === 1 ? o.orgs[0].value : ''}>
              <option value="" disabled>Choose…</option>{o.orgs.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              {o.canCentral && <option value="central">Not sure – central review queue</option>}
            </select></div>
          <Fields o={o} />
          <div><label className="label" htmlFor="l-fu">Next follow-up</label><input className="input" id="l-fu" name="nextFollowupOn" type="date" /></div>
          <div className="md:col-span-2"><label className="label" htmlFor="l-note">First note</label><input className="input" id="l-note" name="note" /></div>
          <label className="flex items-center gap-2 text-sm md:col-span-3"><input type="checkbox" name="consent" value="yes" required /> The person agreed to be contacted by us *</label>
          <FieldError state={s} name="consent" />
          <div className="md:col-span-3"><SubmitButton>Add lead</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function EditLeadForm({ id, o, v }: { id: string; o: LeadFormOptions; v: LeadValues }) {
  return (
    <ActionForm action={updateLeadAction.bind(null, id)} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Fields o={o} v={v} />
      <div className="md:col-span-3"><SubmitButton className="btn-secondary">Save details</SubmitButton></div>
    </ActionForm>
  )
}

export function LeadWorkForm({ id, status, assignedTo, followup, staff }: { id: string; status: string; assignedTo: string | null; followup: string | null; staff: Opt[] }) {
  const [st, setSt] = useState(status)
  const locked = ['application_started', 'admission_confirmed'].includes(status)
  return (
    <ActionForm action={leadWorkAction.bind(null, id)} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {(s) => (
        <>
          <div><label className="label" htmlFor="w-status">Status</label>
            <select className="input" id="w-status" name="status" value={st} onChange={(e) => setSt(e.target.value)} disabled={locked}>
              {locked && <option value={status}>{status === 'application_started' ? 'Application started' : 'Admission confirmed'}</option>}
              {STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
            {locked && <input type="hidden" name="status" value={status} />}</div>
          <Sel name="assignedTo" label="Assigned to" opts={staff} value={assignedTo} any="Nobody" />
          <div><label className="label" htmlFor="w-fu">Next follow-up</label><input className="input" id="w-fu" name="nextFollowupOn" type="date" defaultValue={followup ?? ''} /></div>
          {['not_interested', 'closed', 'invalid'].includes(st) && (
            <div className="md:col-span-3"><label className="label" htmlFor="w-reason">Reason *</label><input className="input" id="w-reason" name="closedReason" required /><FieldError state={s} name="closedReason" /></div>)}
          <div><label className="label" htmlFor="w-kind">Log</label>
            <select className="input" id="w-kind" name="noteKind" defaultValue="note"><option value="note">Note</option><option value="call">Call / conversation</option></select></div>
          <div className="md:col-span-2"><label className="label" htmlFor="w-note">What happened?</label><input className="input" id="w-note" name="note" maxLength={2000} /></div>
          <div className="md:col-span-3"><SubmitButton>Save</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function RouteForm({ id, orgs, current }: { id: string; orgs: Opt[]; current: string | null }) {
  return (
    <ActionForm action={routeLeadAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
      <div><label className="label" htmlFor="r-org">Route to</label>
        <select className="input" id="r-org" name="orgId" defaultValue={current ?? 'central'}>
          <option value="central">Central review queue</option>{orgs.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></div>
      <SubmitButton className="btn-secondary">Route</SubmitButton>
    </ActionForm>
  )
}

export function DuplicateButtons({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionForm action={duplicateAction.bind(null, id, 'not_duplicate')}><SubmitButton className="btn-secondary btn-sm">Not a duplicate</SubmitButton></ActionForm>
      <ActionForm action={duplicateAction.bind(null, id, 'duplicate')}><SubmitButton className="btn-danger btn-sm">It is a duplicate</SubmitButton></ActionForm>
    </div>
  )
}

export function ConvertButton({ id }: { id: string }) {
  return <ActionForm action={convertLeadAction.bind(null, id)}><SubmitButton className="btn-primary">Register as student</SubmitButton></ActionForm>
}

export function ImportForm({ orgs, canCentral }: { orgs: Opt[]; canCentral: boolean }) {
  return (
    <ActionForm action={importLeadsAction} className="space-y-3">
      {(s) => (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><label className="label" htmlFor="i-src">Source</label>
              <select className="input" id="i-src" name="source" defaultValue="leadist"><option value="leadist">Leadist export</option><option value="import">Other list</option></select></div>
            <div><label className="label" htmlFor="i-org">Import into</label>
              <select className="input" id="i-org" name="orgId" required defaultValue={orgs.length === 1 ? orgs[0].value : ''}>
                <option value="" disabled>Choose…</option>{orgs.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                {canCentral && <option value="central">Central review queue</option>}</select></div>
            <div><label className="label" htmlFor="i-file">CSV file (max 1,000 rows)</label><input className="input" id="i-file" name="file" type="file" accept=".csv,text/csv" required /></div>
          </div>
          {Array.isArray(s.data?.errors) && s.data.errors.length > 0 && (
            <ul className="max-h-48 overflow-auto rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{(s.data.errors as string[]).map((e) => <li key={e}>{e}</li>)}</ul>)}
          <SubmitButton>Import</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}
