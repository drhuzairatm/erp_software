'use client'

import { updateMyProfileAction } from '@/app/actions/admin'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'
import type { ProfileFields } from '@/services/admin'

const FIELDS: { name: string; col: keyof ProfileFields | 'phone'; label: string; type?: string; wide?: boolean }[] = [
  { name: 'firstName', col: 'first_name', label: 'First name' }, { name: 'middleName', col: 'middle_name', label: 'Middle name' }, { name: 'lastName', col: 'last_name', label: 'Last name' },
  { name: 'displayName', col: 'display_name', label: 'Display name (shown across the ERP)' },
  { name: 'phone', col: 'phone', label: 'Primary phone', type: 'tel' }, { name: 'secondaryPhone', col: 'secondary_phone', label: 'Secondary phone', type: 'tel' }, { name: 'additionalPhone', col: 'additional_phone', label: 'Additional phone (optional)', type: 'tel' },
  { name: 'addressLine', col: 'address_line', label: 'Address', wide: true }, { name: 'city', col: 'city', label: 'City' }, { name: 'stateRegion', col: 'state_region', label: 'State' },
  { name: 'postalCode', col: 'postal_code', label: 'Postal code' }, { name: 'addressCountry', col: 'address_country', label: 'Country' },
]

export function MyProfileForm({ v }: { v: ProfileFields & { phone: string | null } }) {
  return (
    <ActionForm action={updateMyProfileAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {(s) => (<>
        {FIELDS.map((f) => (
          <div key={f.name} className={f.wide ? 'md:col-span-2' : ''}>
            <label className="label" htmlFor={`pf-${f.name}`}>{f.label}</label>
            <input className="input" id={`pf-${f.name}`} name={f.name} type={f.type ?? 'text'} defaultValue={v[f.col] ?? ''} />
            <FieldError state={s} name={f.name} />
          </div>
        ))}
        <div className="md:col-span-2"><SubmitButton>Save my details</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}
