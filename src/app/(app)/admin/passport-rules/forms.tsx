'use client'

import { addValidityRuleAction, contactStageAction, toggleValidityRuleAction } from '@/app/actions/passport'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'

type Opt = { id: string; name: string }

export function ContactStageForm({ stages, current }: { stages: { key: string; name: string }[]; current: string | null }) {
  return (
    <ActionForm action={contactStageAction} className="flex flex-wrap items-end gap-2">
      <div><label className="label" htmlFor="cs-stage">Require primary phone, secondary phone and email from</label>
        <select className="input" id="cs-stage" name="stageKey" defaultValue={current ?? ''}>
          <option value="">Never (not enforced)</option>{stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select></div>
      <SubmitButton className="btn-secondary">Save</SubmitButton>
    </ActionForm>
  )
}

export function AddRuleForm({ countries, universities, courses, stages }: { countries: Opt[]; universities: Opt[]; courses: Opt[]; stages: { key: string; name: string }[] }) {
  const sel = (name: string, text: string, opts: Opt[]) => (
    <div><label className="label" htmlFor={`r-${name}`}>{text}</label>
      <select className="input" id={`r-${name}`} name={name} defaultValue=""><option value="">Any</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
  )
  return (
    <ActionForm action={addValidityRuleAction} className="grid grid-cols-1 gap-3 md:grid-cols-3" resetOnSuccess>
      {(s) => (
        <>
          <div className="md:col-span-2"><label className="label" htmlFor="r-name">Rule name</label>
            <input className="input" id="r-name" name="name" required placeholder="e.g. Bulgaria visa – passport valid 18 months" /><FieldError state={s} name="name" /></div>
          <div><label className="label" htmlFor="r-months">Minimum validity (months)</label>
            <input className="input" id="r-months" name="minMonths" inputMode="numeric" required /><FieldError state={s} name="minMonths" /></div>
          {sel('destinationCountryId', 'Destination', countries)}
          {sel('universityId', 'University', universities)}
          {sel('courseId', 'Course / pathway', courses)}
          <div><label className="label" htmlFor="r-stage">Checked from stage</label>
            <select className="input" id="r-stage" name="stageKey" required defaultValue=""><option value="" disabled>Choose…</option>{stages.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select>
            <FieldError state={s} name="stageKey" /></div>
          <div><label className="label" htmlFor="r-enf">When not met</label>
            <select className="input" id="r-enf" name="enforcement" defaultValue="warn"><option value="warn">Warn (staff acknowledge)</option><option value="block">Block the stage change</option></select></div>
          <div><label className="label" htmlFor="r-notes">Source / notes</label><input className="input" id="r-notes" name="notes" /></div>
          <div className="md:col-span-3"><SubmitButton>Add rule</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function ToggleRule({ id, active }: { id: string; active: boolean }) {
  return <ActionForm action={toggleValidityRuleAction.bind(null, id, !active)} className="inline"><SubmitButton className="btn-ghost btn-sm" pendingText="…">{active ? 'Deactivate' : 'Activate'}</SubmitButton></ActionForm>
}
