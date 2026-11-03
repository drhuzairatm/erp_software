'use client'

import { saveCourierAddressAction } from '@/app/actions/courier'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'

type Value = { label: string; recipient: string; address: string; phone: string | null; instructions: string | null; is_active: boolean }

export function AddressForm({ id, orgs, value }: { id: string | null; orgs: { id: string; name: string }[]; value: Value | null }) {
  const k = id ?? 'new'
  return (
    <ActionForm action={saveCourierAddressAction.bind(null, id)} className="grid grid-cols-1 gap-3 md:grid-cols-2" resetOnSuccess={!id}>
      {(s) => (
        <>
          {!id && (
            <div className="md:col-span-2"><label className="label" htmlFor={`ca-org-${k}`}>Company *</label>
              <select className="input" id={`ca-org-${k}`} name="orgId" required defaultValue={orgs.length === 1 ? orgs[0].id : ''}>
                <option value="">Choose…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select><FieldError state={s} name="orgId" /></div>
          )}
          <div><label className="label" htmlFor={`ca-label-${k}`}>Name of this address *</label>
            <input className="input" id={`ca-label-${k}`} name="label" defaultValue={value?.label} maxLength={120} required placeholder="e.g. Head office" /><FieldError state={s} name="label" /></div>
          <div><label className="label" htmlFor={`ca-rec-${k}`}>Recipient *</label>
            <input className="input" id={`ca-rec-${k}`} name="recipient" defaultValue={value?.recipient} maxLength={200} required /><FieldError state={s} name="recipient" /></div>
          <div className="md:col-span-2"><label className="label" htmlFor={`ca-addr-${k}`}>Full delivery address *</label>
            <textarea className="input min-h-24" id={`ca-addr-${k}`} name="address" defaultValue={value?.address} maxLength={1000} required /><FieldError state={s} name="address" /></div>
          <div><label className="label" htmlFor={`ca-phone-${k}`}>Contact phone</label>
            <input className="input" id={`ca-phone-${k}`} name="phone" defaultValue={value?.phone ?? ''} maxLength={40} /></div>
          {id && (
            <div className="flex items-end"><label className="flex items-center gap-2 text-sm">
              <input type="hidden" name="isActive" value="false" />
              <input type="checkbox" name="isActive" value="true" defaultChecked={value?.is_active} /> Active (can be used for new instructions)</label></div>
          )}
          <div className="md:col-span-2"><label className="label" htmlFor={`ca-ins-${k}`}>Instructions for the sender</label>
            <textarea className="input min-h-20" id={`ca-ins-${k}`} name="instructions" defaultValue={value?.instructions ?? ''} maxLength={2000}
              placeholder="e.g. how to pack the documents, office hours" /></div>
          <div className="md:col-span-2"><SubmitButton>{id ? 'Save changes' : 'Add address'}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}
