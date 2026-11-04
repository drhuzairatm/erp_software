'use client'

import { saveCurrencyAction } from '@/app/actions/payments'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'

export function CurrencyForm({ c }: { c: { code: string; name: string; symbol: string; is_active: boolean; reference_rate: string | null; reference_rate_date: string | null } | null }) {
  const k = c?.code ?? 'new'
  return (
    <ActionForm action={saveCurrencyAction} className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-6" resetOnSuccess={!c}>
      {(s) => (
        <>
          <div><label className="label text-xs" htmlFor={`cc-${k}`}>Code</label>
            <input className="input py-1.5 font-mono uppercase" id={`cc-${k}`} name="code" defaultValue={c?.code} readOnly={!!c} maxLength={3} required /><FieldError state={s} name="code" /></div>
          <div className="md:col-span-2"><label className="label text-xs" htmlFor={`cn-${k}`}>Name</label><input className="input py-1.5" id={`cn-${k}`} name="name" defaultValue={c?.name} required /></div>
          <div><label className="label text-xs" htmlFor={`cs-${k}`}>Symbol</label><input className="input py-1.5" id={`cs-${k}`} name="symbol" defaultValue={c?.symbol} maxLength={5} /></div>
          <div><label className="label text-xs" htmlFor={`cr-${k}`}>Reference rate (INR for 1)</label>
            <input className="input py-1.5" id={`cr-${k}`} name="referenceRate" inputMode="decimal" defaultValue={c?.reference_rate ? String(Number(c.reference_rate)) : ''} disabled={c?.code === 'INR'} /><FieldError state={s} name="referenceRate" /></div>
          <div><label className="label text-xs" htmlFor={`cd-${k}`}>Rate date</label><input className="input py-1.5" id={`cd-${k}`} name="referenceRateDate" type="date" defaultValue={c?.reference_rate_date ?? ''} disabled={c?.code === 'INR'} /></div>
          {c && c.code !== 'INR' && (
            <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="hidden" name="isActive" value="false" /><input type="checkbox" name="isActive" value="true" defaultChecked={c.is_active} /> Available for new entries</label>)}
          <div className="flex items-end sm:col-span-2 md:col-span-6"><SubmitButton className="btn-secondary btn-sm">{c ? 'Save' : 'Add currency'}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}
