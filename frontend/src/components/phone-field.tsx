'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { DEFAULT_PHONE_COUNTRY, formatPhone, phoneCountries } from '@/lib/phone'

/**
 * Phone number with its own country-code selector (all countries/territories; search by name or code).
 * Choosing a country never rewrites the number; a mismatching "+code" is pointed out instead.
 */
export function PhoneField({ name, label, required, defaultValue, defaultCountry, hint, invalid }: {
  name: string; label: string; required?: boolean; defaultValue?: string; defaultCountry?: string; hint?: string; invalid?: boolean
}) {
  const countries = useMemo(() => phoneCountries(), [])
  const [country, setCountry] = useState(defaultCountry || DEFAULT_PHONE_COUNTRY)
  const [number, setNumber] = useState(defaultValue ? formatPhone(defaultValue) ?? '' : '')
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const current = countries.find((c) => c.code === country)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const term = q.trim().toLowerCase().replace(/^\+/, '')
  const list = term ? countries.filter((c) => c.name.toLowerCase().includes(term) || c.dial.startsWith(term) || c.code.toLowerCase() === term) : countries
  const typedCode = number.trim().startsWith('+') ? number.replace(/[^\d+]/g, '').slice(1) : ''
  const mismatch = current && typedCode && !typedCode.startsWith(current.dial)
  return (
    <div>
      <label className="label" htmlFor={`${id}-n`}>{label}{required && ' *'}</label>
      <div className="relative flex gap-1" ref={box}>
        <input type="hidden" name={`${name}Country`} value={country} />
        <button type="button" className="input w-auto shrink-0 px-2" aria-haspopup="listbox" aria-expanded={open}
          aria-label={`Country code for ${label}: ${current?.name} +${current?.dial}`} onClick={() => setOpen(!open)}>
          <span aria-hidden>{current?.flag}</span> +{current?.dial} <span aria-hidden className="text-slate-400">▾</span>
        </button>
        <input className="input min-w-0 flex-1" id={`${id}-n`} name={name} type="tel" autoComplete="off" value={number}
          onChange={(e) => setNumber(e.target.value)} aria-invalid={invalid || undefined} />
        {open && (
          <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-md sm:w-72 border border-slate-200 bg-white p-2 shadow-lg">
            <input className="input mb-2 py-1 text-sm" autoFocus placeholder="Search country or code" aria-label="Search country or calling code"
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter') { e.preventDefault(); if (list[0]) { setCountry(list[0].code); setOpen(false); setQ('') } } }} />
            <ul role="listbox" aria-label="Countries" className="max-h-60 overflow-y-auto text-sm">
              {list.map((c) => (
                <li key={c.code} role="option" aria-selected={c.code === country}>
                  <button type="button" className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-100 ${c.code === country ? 'bg-brand-50' : ''}`}
                    onClick={() => { setCountry(c.code); setOpen(false); setQ('') }}>
                    <span aria-hidden>{c.flag}</span><span className="flex-1">{c.name}</span><span className="text-slate-500">+{c.dial}</span>
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="px-2 py-1 text-slate-500">No match</li>}
            </ul>
          </div>
        )}
      </div>
      {mismatch && <p className="mt-1 text-xs text-amber-800">The number starts with +{typedCode.slice(0, 4)}…, which is not the code of {current?.name} (+{current?.dial}). Check the country or the number.</p>}
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}
