'use client'

import { useState } from 'react'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'
import { portalReferralAction, publicReferralAction } from './actions'

type Opt = { id: string; name: string }
const PROGRAMMES = [['mbbs', 'MBBS'], ['nursing', 'Nursing'], ['medical_pg', 'Medical PG (MD/MS)'], ['bachelors', "Bachelor's degree"], ['general_pg', 'Postgraduate (non-medical)'], ['not_sure', 'Not sure yet']]

/** Friend's details. `mode` decides who fills it in (the student in the portal, or the friend on a shared link). */
export function ReferralForm({ mode, code, countries, destinations }: { mode: 'portal' | 'link'; code?: string; countries: Opt[]; destinations: Opt[] }) {
  const action = mode === 'portal' ? portalReferralAction : publicReferralAction.bind(null, code ?? '')
  const you = mode === 'link'
  return (
    <ActionForm action={action} className="space-y-3" resetOnSuccess>
      {(s) => (
        <>
          <div><label className="label" htmlFor="rf-name">{you ? 'Your name *' : "Friend's name *"}</label><input className="input text-base" id="rf-name" name="name" required maxLength={200} /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="rf-phone">Mobile number</label><input className="input text-base" id="rf-phone" name="phone" type="tel" inputMode="tel" maxLength={30} /></div>
            <div><label className="label" htmlFor="rf-wa">WhatsApp (if different)</label><input className="input text-base" id="rf-wa" name="whatsapp" type="tel" inputMode="tel" maxLength={30} /></div>
          </div>
          <div><label className="label" htmlFor="rf-email">Email</label><input className="input text-base" id="rf-email" name="email" type="email" maxLength={200} /><FieldError state={s} name="email" /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="rf-prog">Course / programme *</label>
              <select className="input text-base" id="rf-prog" name="programme" required defaultValue=""><option value="" disabled>Choose…</option>{PROGRAMMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label className="label" htmlFor="rf-dest">Destination country</label>
              <select className="input text-base" id="rf-dest" name="destinationCountryId" defaultValue=""><option value="">Not decided</option>{destinations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label" htmlFor="rf-res">Country of residence</label>
              <select className="input text-base" id="rf-res" name="residenceCountryId" defaultValue=""><option value="">—</option>{countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label" htmlFor="rf-qual">Qualification</label><input className="input text-base" id="rf-qual" name="qualification" maxLength={200} placeholder="e.g. Plus Two (Science)" /></div>
          </div>
          <div><label className="label" htmlFor="rf-pref">Preferred company (optional)</label><input className="input text-base" id="rf-pref" name="preferredCompany" maxLength={120} /></div>
          <div><label className="label" htmlFor="rf-rem">Remarks</label><textarea className="input min-h-16 text-base" id="rf-rem" name="remarks" maxLength={2000} /></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" value="yes" required className="mt-1" />
            <span>{you ? 'I agree to be contacted by phone, WhatsApp or email about studying abroad. *' : 'My friend agreed that you may contact them about studying abroad. *'}</span></label>
          <SubmitButton className="btn-primary w-full">{you ? 'Send my details' : 'Refer my friend'}</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}

export function ShareReferral({ url, company }: { url: string; company: string }) {
  const [copied, setCopied] = useState(false)
  const text = `I'm applying with ${company}. If you're thinking about studying abroad, leave your details here and they will contact you: ${url}`
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input readOnly aria-label="Your referral link" className="input min-w-0 flex-1 font-mono text-xs" value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn-secondary btn-sm" onClick={async () => { await navigator.clipboard?.writeText(url); setCopied(true) }}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="btn-secondary btn-sm" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <a className="btn-secondary btn-sm" href={`mailto:?subject=${encodeURIComponent('Study abroad – ' + company)}&body=${encodeURIComponent(text)}`}>Email</a>
        <button type="button" className="btn-secondary btn-sm" onClick={() => { if (navigator.share) navigator.share({ title: company, text, url }).catch(() => {}); else navigator.clipboard?.writeText(url).then(() => setCopied(true)) }}>Share…</button>
      </div>
    </div>
  )
}
