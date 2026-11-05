'use client'

import { saveCountryRuleAction, setCountryRuleActiveAction, verifyCountryRuleAction } from '@/app/actions/preferences'
import { ActionForm, SubmitButton } from '@/components/forms'

type Opt = { id: string; name: string }
export type RuleOptions = { countries: Opt[]; universities: (Opt & { country_id: string })[]; courses: Opt[]; documents: Opt[]; stages: { key: string; name: string }[] }
type V = { id?: string; country_id?: string; university_id?: string | null; course_id?: string | null; document_type_id?: string; stage_key?: string | null; is_required?: boolean; match_rule?: string | null; guidance?: string | null; source_note?: string | null }

export function RuleForm({ options, v }: { options: RuleOptions; v?: V }) {
  const p = v?.id ? `e${v.id.slice(0, 6)}` : 'new'
  return (
    <ActionForm action={saveCountryRuleAction.bind(null, v?.id ?? null)} resetOnSuccess={!v?.id} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div><label className="label" htmlFor={`${p}-c`}>Country *</label><select className="input" id={`${p}-c`} name="countryId" required defaultValue={v?.country_id ?? ''}><option value="">Choose</option>{options.countries.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}-d`}>Document *</label><select className="input" id={`${p}-d`} name="documentTypeId" required defaultValue={v?.document_type_id ?? ''}><option value="">Choose</option>{options.documents.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}-u`}>University (optional)</label><select className="input" id={`${p}-u`} name="universityId" defaultValue={v?.university_id ?? ''}><option value="">Every university in the country</option>{options.universities.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}-p`}>Programme (optional)</label><select className="input" id={`${p}-p`} name="courseId" defaultValue={v?.course_id ?? ''}><option value="">Every programme</option>{options.courses.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}-s`}>Stage</label><select className="input" id={`${p}-s`} name="stageKey" defaultValue={v?.stage_key ?? ''}><option value="">Any stage</option>{options.stages.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}-r`}>Requirement</label><select className="input" id={`${p}-r`} name="required" defaultValue={v?.is_required === false ? 'no' : 'yes'}><option value="yes">Required</option><option value="no">Recommended</option></select></div>
      <div className="md:col-span-2"><label className="label" htmlFor={`${p}-m`}>Check</label><select className="input" id={`${p}-m`} name="matchRule" defaultValue={v?.match_rule ? 'visa' : ''}><option value="">No check</option><option value="visa">Issuing country must match the visa application country</option></select></div>
      <div className="md:col-span-2"><label className="label" htmlFor={`${p}-g`}>Guidance, including timing</label><textarea className="input" id={`${p}-g`} name="guidance" rows={2} defaultValue={v?.guidance ?? ''} maxLength={2000} /></div>
      <div className="md:col-span-2"><label className="label" htmlFor={`${p}-n`}>Source of this rule</label><input className="input" id={`${p}-n`} name="sourceNote" defaultValue={v?.source_note ?? ''} maxLength={500} /></div>
      <div className="md:col-span-2"><SubmitButton className="btn-secondary">Save rule</SubmitButton></div>
    </ActionForm>
  )
}
export function VerifyForm({ id, verified }: { id: string; verified: boolean }) {
  return (
    <ActionForm action={verifyCountryRuleAction.bind(null, id, !verified)} className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1"><label className="label" htmlFor={`vn-${id}`}>Based on</label><input className="input" id={`vn-${id}`} name="note" required maxLength={500} /></div>
      <SubmitButton className="btn-secondary">{verified ? 'Mark unverified' : 'Mark verified'}</SubmitButton>
    </ActionForm>
  )
}
export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  return <ActionForm action={setCountryRuleActiveAction.bind(null, id, !active)} className=""><SubmitButton className="btn-secondary">{active ? 'Deactivate' : 'Activate'}</SubmitButton></ActionForm>
}
