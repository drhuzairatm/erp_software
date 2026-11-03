'use client'

import { addAuthorityAction, addStageAction, approveRouteAction, deleteRouteDraftAction, moveStageAction, newRouteVersionAction, removeStageAction, saveRouteAction, toggleAuthorityAction } from '@/app/actions/attestation'
import { ConditionBuilder, type ConditionOptions } from '@/components/condition-builder'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'
import type { Condition } from '@/lib/conditions'

type Opt = { value: string; label: string }
export interface RouteOptions { countries: Opt[]; documentTypes: Opt[]; universities: Opt[]; authorities: Opt[]; departments: string[] }

export function RouteForm({ id, options, initial, readOnly, condOptions, conditions, conditionsText }: { id: string | null; options: RouteOptions; initial?: Record<string, string | null>; readOnly?: boolean
  condOptions: ConditionOptions; conditions?: Condition | null; conditionsText?: string }) {
  const v = (k: string) => initial?.[k] ?? ''
  const sel = (name: string, text: string, opts: Opt[], any: string) => (
    <div><label className="label" htmlFor={name}>{text}</label>
      <select className="input" id={name} name={name} defaultValue={v(name)} disabled={readOnly}><option value="">{any}</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
  )
  return (
    <ActionForm action={saveRouteAction.bind(null, id)} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {(s) => (
        <>
          <div className="md:col-span-2"><label className="label" htmlFor="name">Route name</label>
            <input className="input" id="name" name="name" required defaultValue={v('name')} disabled={readOnly} placeholder="e.g. Bulgaria – India-issued documents – Apostille" />
            <FieldError state={s} name="name" /></div>
          <div><label className="label" htmlFor="routeType">Type</label>
            <select className="input" id="routeType" name="routeType" defaultValue={v('routeType') || 'apostille'} disabled={readOnly}>
              <option value="apostille">Apostille</option><option value="legalisation">Legalisation (non-apostille)</option><option value="other">Other</option></select></div>
          <div><label className="label" htmlFor="destinationCountryId">Destination country *</label>
            <select className="input" id="destinationCountryId" name="destinationCountryId" required defaultValue={v('destinationCountryId')} disabled={readOnly}>
              <option value="" disabled>Choose…</option>{options.countries.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <FieldError state={s} name="destinationCountryId" /></div>
          {sel('issuingCountryId', 'Document issuing country', options.countries, 'Any')}
          {sel('documentTypeId', 'Document type', options.documentTypes, 'Any document')}
          {sel('visaApplicationCountryId', 'Visa application country', options.countries, 'Any')}
          {sel('previousEducationCountryId', 'Previous education country', options.countries, 'Any')}
          {sel('universityId', 'University', options.universities, 'Any')}
          <div className="md:col-span-3"><label className="label" htmlFor="sourceNote">Source of this procedure</label>
            <input className="input" id="sourceNote" name="sourceNote" defaultValue={v('sourceNote')} disabled={readOnly} placeholder="e.g. Business procedure supplied by the MD, Oct 2026 – not legal advice" /></div>
          <div className="md:col-span-3"><label className="label" htmlFor="description">Notes</label>
            <input className="input" id="description" name="description" defaultValue={v('description')} disabled={readOnly} /></div>
          <div className="md:col-span-3">{readOnly
            ? <p className="text-sm"><span className="label inline">Extra conditions: </span>{conditionsText ?? 'No extra conditions'}</p>
            : <><ConditionBuilder initial={conditions ?? null} options={condOptions} label="Extra conditions (optional) – e.g. nationality" /><FieldError state={s} name="conditions" /></>}</div>
          {!readOnly && <div className="md:col-span-3"><SubmitButton>{id ? 'Save draft' : 'Create draft'}</SubmitButton></div>}
          <p className="hint md:col-span-3">The most specific approved route that matches a document is listed first. Staff choose the route when starting attestation.</p>
        </>
      )}
    </ActionForm>
  )
}

export function AddStageForm({ routeId, options }: { routeId: string; options: RouteOptions }) {
  return (
    <ActionForm action={addStageAction.bind(null, routeId)} className="grid grid-cols-1 gap-3 md:grid-cols-4" resetOnSuccess>
      {(s) => (
        <>
          <div className="md:col-span-2"><label className="label" htmlFor="st-name">Stage</label><input className="input" id="st-name" name="name" required placeholder="e.g. UAE Ministry of Foreign Affairs attestation" /><FieldError state={s} name="name" /></div>
          <div><label className="label" htmlFor="st-auth">Authority</label>
            <select className="input" id="st-auth" name="authorityId" defaultValue=""><option value="">—</option>{options.authorities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
          <div><label className="label" htmlFor="st-dept">Responsible department</label>
            <select className="input" id="st-dept" name="responsibleDepartment" defaultValue="Attestation"><option value="">—</option>{options.departments.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
          <div><label className="label" htmlFor="st-days">Expected days</label><input className="input" id="st-days" name="expectedDays" inputMode="numeric" /></div>
          <div className="md:col-span-3"><label className="label" htmlFor="st-guid">Guidance for staff</label><input className="input" id="st-guid" name="guidance" /></div>
          <div className="flex flex-wrap gap-4 text-sm md:col-span-4">
            <label className="flex items-center gap-1"><input type="checkbox" name="optional" value="yes" /> Optional stage</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="requiresReference" value="yes" /> Reference number required</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="requiresFile" value="yes" /> Supporting document required</label>
          </div>
          <div><SubmitButton className="btn-secondary">Add stage</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function StageButtons({ routeId, stageId }: { routeId: string; stageId: string }) {
  return (
    <span className="flex gap-1">
      <ActionForm action={moveStageAction.bind(null, routeId, stageId, 'up')} className="inline"><SubmitButton className="btn-ghost btn-sm" pendingText="…">↑</SubmitButton></ActionForm>
      <ActionForm action={moveStageAction.bind(null, routeId, stageId, 'down')} className="inline"><SubmitButton className="btn-ghost btn-sm" pendingText="…">↓</SubmitButton></ActionForm>
      <ActionForm action={removeStageAction.bind(null, routeId, stageId)} className="inline"><SubmitButton className="btn-ghost btn-sm" pendingText="…">Remove</SubmitButton></ActionForm>
    </span>
  )
}

export function ApproveRouteButton({ id }: { id: string }) {
  return <ActionForm action={approveRouteAction.bind(null, id)}><ConfirmSubmit className="btn-primary" confirmText="Approve this route? Staff can use it from today.">Approve route</ConfirmSubmit></ActionForm>
}
export function NewRouteVersionButton({ id }: { id: string }) {
  return <ActionForm action={newRouteVersionAction.bind(null, id)}><SubmitButton className="btn-secondary">Create new version to edit</SubmitButton></ActionForm>
}
export function DeleteRouteDraftButton({ id }: { id: string }) {
  return <ActionForm action={deleteRouteDraftAction.bind(null, id)}><ConfirmSubmit className="btn-ghost" confirmText="Delete this draft?">Delete draft</ConfirmSubmit></ActionForm>
}

export function AddAuthorityForm({ countries }: { countries: Opt[] }) {
  return (
    <ActionForm action={addAuthorityAction} className="grid grid-cols-1 gap-2 md:grid-cols-4" resetOnSuccess>
      <div className="md:col-span-2"><label className="label text-xs" htmlFor="au-name">Authority</label><input className="input py-1.5" id="au-name" name="name" required placeholder="e.g. Embassy of Bulgaria in the UAE" /></div>
      <div><label className="label text-xs" htmlFor="au-country">Country</label><select className="input py-1.5" id="au-country" name="countryId" defaultValue=""><option value="">—</option>{countries.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
      <div><label className="label text-xs" htmlFor="au-kind">Kind</label>
        <select className="input py-1.5" id="au-kind" name="kind" defaultValue="other">
          <option value="apostille_authority">Apostille authority</option><option value="education_ministry">Ministry of Education</option><option value="foreign_affairs">Ministry of Foreign Affairs</option>
          <option value="embassy">Embassy / consulate</option><option value="home_department">Home / HRD department</option><option value="notary">Notary</option><option value="university">University</option><option value="other">Other</option>
        </select></div>
      <div><SubmitButton className="btn-secondary btn-sm">Add authority</SubmitButton></div>
    </ActionForm>
  )
}
export function ToggleAuthority({ id, active }: { id: string; active: boolean }) {
  return <ActionForm action={toggleAuthorityAction.bind(null, id, !active)} className="inline"><SubmitButton className="btn-ghost btn-sm" pendingText="…">{active ? 'Deactivate' : 'Activate'}</SubmitButton></ActionForm>
}
