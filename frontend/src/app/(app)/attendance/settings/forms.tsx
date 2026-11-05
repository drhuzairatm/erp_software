'use client'

import { saveOfficeAction, savePolicyAction, setOfficeActiveAction } from '@/app/actions/attendance'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'

type Office = { id: string; name: string; latitude: number | null; longitude: number | null; radius_m: number; allowed_ips: string[]; is_active: boolean }

export function OfficeForm({ orgId, office }: { orgId: string; office?: Office }) {
  const k = office?.id ?? `new-${orgId}`
  return (
    <ActionForm action={saveOfficeAction.bind(null, orgId, office?.id ?? null)} resetOnSuccess={!office} className="grid grid-cols-1 gap-3 md:grid-cols-5">
      {(s) => (<>
        <div><label className="label" htmlFor={`on-${k}`}>Name</label><input className="input" id={`on-${k}`} name="name" defaultValue={office?.name} required /><FieldError state={s} name="name" /></div>
        <div><label className="label" htmlFor={`ola-${k}`}>Latitude</label><input className="input" id={`ola-${k}`} name="latitude" inputMode="decimal" defaultValue={office?.latitude ?? ''} /><FieldError state={s} name="latitude" /></div>
        <div><label className="label" htmlFor={`olo-${k}`}>Longitude</label><input className="input" id={`olo-${k}`} name="longitude" inputMode="decimal" defaultValue={office?.longitude ?? ''} /><FieldError state={s} name="longitude" /></div>
        <div><label className="label" htmlFor={`or-${k}`}>Radius (metres)</label><input className="input" id={`or-${k}`} name="radius" type="number" min={10} max={5000} defaultValue={office?.radius_m ?? 150} /></div>
        <div><label className="label" htmlFor={`oi-${k}`}>Office public IPs</label><input className="input" id={`oi-${k}`} name="allowedIps" defaultValue={office?.allowed_ips.join(', ')} placeholder="203.0.113.10, 198.51.100.0/24" /><FieldError state={s} name="allowedIps" /></div>
        <div className="md:col-span-5"><SubmitButton className="btn-secondary btn-sm">{office ? 'Save office' : 'Add office'}</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}

export function OfficeToggle({ id, active }: { id: string; active: boolean }) {
  return <ActionForm action={setOfficeActiveAction.bind(null, id, !active)} className="inline"><SubmitButton className="btn-ghost btn-sm">{active ? 'Deactivate' : 'Activate'}</SubmitButton></ActionForm>
}

type Policy = { work_start: string; work_end: string; grace_minutes: number; half_day_minutes: number; max_gps_accuracy_m: number; require_gps: boolean; require_ip: boolean; require_qr: boolean; require_photo: boolean; weekly_off: number[]; leave_types: string[] }
export function PolicyForm({ orgId, p }: { orgId: string; p: Policy }) {
  return (
    <ActionForm action={savePolicyAction.bind(null, orgId)} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {(s) => (<>
        <div><label className="label" htmlFor={`ps-${orgId}`}>Work starts</label><input className="input" id={`ps-${orgId}`} name="workStart" type="time" defaultValue={p.work_start} /><FieldError state={s} name="workStart" /></div>
        <div><label className="label" htmlFor={`pe-${orgId}`}>Work ends</label><input className="input" id={`pe-${orgId}`} name="workEnd" type="time" defaultValue={p.work_end} /><FieldError state={s} name="workEnd" /></div>
        <div><label className="label" htmlFor={`pg-${orgId}`}>Grace (minutes)</label><input className="input" id={`pg-${orgId}`} name="graceMinutes" type="number" min={0} max={240} defaultValue={p.grace_minutes} /><FieldError state={s} name="graceMinutes" /></div>
        <div><label className="label" htmlFor={`ph-${orgId}`}>Half day if worked under (minutes)</label><input className="input" id={`ph-${orgId}`} name="halfDayMinutes" type="number" min={0} max={720} defaultValue={p.half_day_minutes} /><FieldError state={s} name="halfDayMinutes" /></div>
        <div><label className="label" htmlFor={`pa-${orgId}`}>Worst GPS accuracy accepted (metres)</label><input className="input" id={`pa-${orgId}`} name="maxAccuracy" type="number" min={10} max={5000} defaultValue={p.max_gps_accuracy_m} /><FieldError state={s} name="maxAccuracy" /></div>
        <div><label className="label" htmlFor={`pw-${orgId}`}>Weekly off days (0 = Sunday)</label><input className="input" id={`pw-${orgId}`} name="weeklyOff" defaultValue={p.weekly_off.join(', ')} /></div>
        <div className="md:col-span-3"><label className="label" htmlFor={`pl-${orgId}`}>Leave types (comma-separated)</label><input className="input" id={`pl-${orgId}`} name="leaveTypes" defaultValue={p.leave_types.join(', ')} /></div>
        <fieldset className="md:col-span-3"><legend className="label">A missing or failed signal sends the record to manual review. It never refuses attendance.</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-1"><input type="checkbox" name="requireGps" defaultChecked={p.require_gps} />Location</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="requireIp" defaultChecked={p.require_ip} />Office IP</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="requireQr" defaultChecked={p.require_qr} />Office QR</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="requirePhoto" defaultChecked={p.require_photo} />Camera photo</label>
          </div></fieldset>
        <div className="md:col-span-3"><SubmitButton className="btn-secondary btn-sm">Save policy</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}
