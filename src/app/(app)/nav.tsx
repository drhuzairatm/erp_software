'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface NavItem { href: string; label: string }

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname()
  return (
    <ul className="space-y-0.5">
      {items.map((i) => {
        const active = i.href === '/' ? path === '/' : path === i.href || path.startsWith(i.href + '/')
        return (
          <li key={i.href}>
            <Link href={i.href} aria-current={active ? 'page' : undefined}
              className={`block rounded-md px-3 py-2 text-sm font-medium no-underline hover:no-underline ${active ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100'}`}>
              {i.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export function ScopeSelect({ options, value }: { options: { value: string; label: string }[]; value: string }) {
  const path = usePathname()
  return (
    <>
      <input type="hidden" name="back" value={path} />
      <label htmlFor="scope" className="sr-only">Company</label>
      <select id="scope" name="scope" defaultValue={value} className="input py-1.5" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <noscript><button className="btn-secondary btn-sm mt-1" type="submit">Switch</button></noscript>
    </>
  )
}
