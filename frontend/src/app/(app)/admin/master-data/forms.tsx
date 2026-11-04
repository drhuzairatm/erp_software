'use client'

import { useState } from 'react'
import { decideRequestAction, masterStatusAction, requestMasterDataAction, saveCountryAction, saveCourseAction } from '@/app/actions/master-data'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

type Opt = { value: string; label: string }

export function CountryForm({ c, currencies }: { c: { id: string; code: string; name: string; nationality: string | null; currency_code: string | null; notes: string | null; is_destination: boolean; is_education_origin: boolean } | null; currencies: Opt[] }) {
  const k = c?.id ?? 'new'
  const use = c ? (c.is_destination && c.is_education_origin ? 'both' : c.is_education_origin ? 'origin' : 'destination') : 'destination'
  return (
    <ActionForm action={saveCountryAction.bind(null, c?.id ?? null)} className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-6" resetOnSuccess={!c}>
      {(s) => (
        <>
          <div><label className="label text-xs" htmlFor={`cc-${k}`}>ISO code *</label><input className="input py-1.5 font-mono uppercase" id={`cc-${k}`} name="code" defaultValue={c?.code} maxLength={2} required /><FieldError state={s} name="code" /></div>
          <div className="md:col-span-2"><label className="label text-xs" htmlFor={`cn-${k}`}>Country name *</label><input className="input py-1.5" id={`cn-${k}`} name="name" defaultValue={c?.name} required /><FieldError state={s} name="name" /></div>
          <div><label className="label text-xs" htmlFor={`cna-${k}`}>Nationality</label><input className="input py-1.5" id={`cna-${k}`} name="nationality" defaultValue={c?.nationality ?? ''} placeholder="e.g. Bulgarian" /></div>
          <div><label className="label text-xs" htmlFor={`ccur-${k}`}>Currency (indicative)</label>
            <select className="input py-1.5" id={`ccur-${k}`} name="currencyCode" defaultValue={c?.currency_code ?? ''}><option value="">—</option>{currencies.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></div>
          <div><label className="label text-xs" htmlFor={`cu-${k}`}>Used as</label>
            <select className="input py-1.5" id={`cu-${k}`} name="use" defaultValue={use}><option value="destination">Destination</option><option value="origin">Previous education country</option><option value="both">Both</option></select></div>
          <div className="sm:col-span-2 md:col-span-5"><label className="label text-xs" htmlFor={`cno-${k}`}>Notes</label><input className="input py-1.5" id={`cno-${k}`} name="notes" defaultValue={c?.notes ?? ''} /></div>
          <div className="flex items-end"><SubmitButton className="btn-secondary btn-sm">{c ? 'Save' : 'Add country'}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function StatusButton({ kind, id, active, label }: { kind: 'country' | 'university' | 'course'; id: string; active: boolean; label: string }) {
  return (
    <ActionForm action={masterStatusAction.bind(null, kind, id, !active)} className="inline">
      {active
        ? <ConfirmSubmit confirmText={`Deactivate ${label}? It will no longer be offered for new applications.`} className="btn-ghost btn-sm">Deactivate</ConfirmSubmit>
        : <SubmitButton className="btn-secondary btn-sm">Activate</SubmitButton>}
    </ActionForm>
  )
}

export function CourseForm({ c, courses, countries, categories }: {
  c: { id: string; code: string; name: string; category: string; parent_course_id: string | null; default_duration_years: string | null; eligibility: string | null; notes: string | null; country_ids: string[] } | null
  courses: Opt[]; countries: Opt[]; categories: string[]
}) {
  const k = c?.id ?? 'new'
  const [sel, setSel] = useState<string[]>(c?.country_ids ?? [])
  return (
    <ActionForm action={saveCourseAction.bind(null, c?.id ?? null)} className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-6" resetOnSuccess={!c} onSuccess={() => { if (!c) setSel([]) }}>
      {(s) => (
        <>
          <div className="md:col-span-2"><label className="label text-xs" htmlFor={`kn-${k}`}>Course name *</label><input className="input py-1.5" id={`kn-${k}`} name="name" defaultValue={c?.name} required /><FieldError state={s} name="name" /></div>
          {!c && <div><label className="label text-xs" htmlFor={`kc-${k}`}>Code</label><input className="input py-1.5 font-mono uppercase" id={`kc-${k}`} name="code" maxLength={30} placeholder="auto" /></div>}
          <div><label className="label text-xs" htmlFor={`kcat-${k}`}>Category *</label>
            <input className="input py-1.5" id={`kcat-${k}`} name="category" list="course-categories" defaultValue={c?.category ?? ''} required /></div>
          <div><label className="label text-xs" htmlFor={`kp-${k}`}>Specialisation of</label>
            <select className="input py-1.5" id={`kp-${k}`} name="parentCourseId" defaultValue={c?.parent_course_id ?? ''}><option value="">— main course —</option>
              {courses.filter((x) => x.value !== c?.id).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></div>
          <div><label className="label text-xs" htmlFor={`kd-${k}`}>Duration (years)</label><input className="input py-1.5" id={`kd-${k}`} name="duration" inputMode="decimal" defaultValue={c?.default_duration_years ? String(Number(c.default_duration_years)) : ''} /><FieldError state={s} name="duration" /></div>
          {!c && <div><label className="label text-xs" htmlFor={`kpr-${k}`}>Academic details</label>
            <select className="input py-1.5" id={`kpr-${k}`} name="profile" defaultValue="school"><option value="school">Plus Two based</option><option value="pg_medical">MBBS based (PG medical)</option></select></div>}
          <div className="sm:col-span-2 md:col-span-3"><label className="label text-xs" htmlFor={`ke-${k}`}>Eligibility (general)</label><input className="input py-1.5" id={`ke-${k}`} name="eligibility" defaultValue={c?.eligibility ?? ''} /></div>
          <div className="sm:col-span-2 md:col-span-3"><label className="label text-xs" htmlFor={`kno-${k}`}>Notes</label><input className="input py-1.5" id={`kno-${k}`} name="notes" defaultValue={c?.notes ?? ''} /></div>
          <fieldset className="sm:col-span-2 md:col-span-6"><legend className="label text-xs">Offered in countries (optional – without a university, the student form limits courses to these)</legend>
            <div className="flex flex-wrap gap-1.5">{countries.map((x) => (
              <label key={x.value} className={`cursor-pointer rounded-full px-2.5 py-0.5 text-xs ring-1 ${sel.includes(x.value) ? 'bg-brand-50 font-semibold text-brand-800 ring-brand-200' : 'bg-white text-slate-600 ring-slate-200'}`}>
                <input type="checkbox" name="countryIds" value={x.value} className="sr-only" checked={sel.includes(x.value)}
                  onChange={(e) => setSel((v) => e.target.checked ? [...v, x.value] : v.filter((y) => y !== x.value))} />{x.label}</label>))}</div></fieldset>
          <datalist id="course-categories">{categories.map((x) => <option key={x} value={x} />)}</datalist>
          <div className="sm:col-span-2"><SubmitButton className="btn-secondary btn-sm">{c ? 'Save' : 'Add course'}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function RequestForm({ countries, defaultKind = 'university' }: { countries: Opt[]; defaultKind?: string }) {
  const [kind, setKind] = useState(defaultKind)
  return (
    <ActionForm action={requestMasterDataAction} className="grid grid-cols-1 gap-3 md:grid-cols-4" resetOnSuccess>
      {(s) => (
        <>
          <div><label className="label" htmlFor="rq-kind">What is missing?</label>
            <select className="input" id="rq-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="university">A university</option><option value="course">A course</option><option value="country">A country</option></select></div>
          <div><label className="label" htmlFor="rq-name">Name *</label><input className="input" id="rq-name" name="name" required /><FieldError state={s} name="name" /></div>
          {kind === 'university' && <div><label className="label" htmlFor="rq-country">Country *</label>
            <select className="input" id="rq-country" name="countryId" required defaultValue=""><option value="" disabled>Choose…</option>{countries.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
            <FieldError state={s} name="countryId" /></div>}
          <div className={kind === 'university' ? '' : 'md:col-span-2'}><label className="label" htmlFor="rq-details">Details / reason</label><input className="input" id="rq-details" name="details" placeholder="e.g. student asked for it; website" /></div>
          <div className="md:col-span-4"><SubmitButton>Send request</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function DecideForm({ id, kind }: { id: string; kind: string }) {
  const [reject, setReject] = useState(false)
  return (
    <div className="flex flex-wrap items-end gap-2">
      {!reject ? (
        <ActionForm action={decideRequestAction.bind(null, id, true)} className="flex flex-wrap items-end gap-2">
          {(s) => (
            <>
              {kind === 'country' && <div><label className="label text-xs" htmlFor={`dc-${id}`}>ISO code *</label><input className="input w-20 py-1.5 font-mono uppercase" id={`dc-${id}`} name="code" maxLength={2} required /></div>}
              {kind === 'course' && <div><label className="label text-xs" htmlFor={`dc-${id}`}>Code</label><input className="input w-28 py-1.5 font-mono uppercase" id={`dc-${id}`} name="code" maxLength={30} placeholder="auto" /></div>}
              <SubmitButton className="btn-primary btn-sm">Approve &amp; add</SubmitButton>
              <FieldError state={s} name="code" />
            </>
          )}
        </ActionForm>
      ) : (
        <ActionForm action={decideRequestAction.bind(null, id, false)} className="flex flex-wrap items-end gap-2">
          <div><label className="label text-xs" htmlFor={`dn-${id}`}>Reason *</label><input className="input py-1.5" id={`dn-${id}`} name="note" required /></div>
          <SubmitButton className="btn-danger btn-sm">Reject</SubmitButton>
        </ActionForm>
      )}
      <button type="button" className="btn-ghost btn-sm" onClick={() => setReject((x) => !x)}>{reject ? 'Back' : 'Reject…'}</button>
    </div>
  )
}
