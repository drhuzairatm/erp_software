'use client'

import { saveAcademicYearAction, setAcademicYearActiveAction } from '@/app/actions/preferences'
import { ActionForm, SubmitButton } from '@/components/forms'

export function YearForm() {
  return (
    <ActionForm action={saveAcademicYearAction.bind(null, null)} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <div><label className="label" htmlFor="y-code">Academic year</label><input className="input" id="y-code" name="code" required placeholder="2027-28" maxLength={9} /></div>
      <div><label className="label" htmlFor="y-sort">Display order</label><input className="input" id="y-sort" name="sort" type="number" min={0} max={9999} /></div>
      <SubmitButton>Add academic year</SubmitButton>
    </ActionForm>
  )
}
export function YearToggle({ id, code, active }: { id: string; code: string; active: boolean }) {
  return <ActionForm action={setAcademicYearActiveAction.bind(null, id, code, !active)} className=""><SubmitButton className="btn-secondary" pendingText="Saving…">{active ? 'Deactivate' : 'Activate'} {code}</SubmitButton></ActionForm>
}
