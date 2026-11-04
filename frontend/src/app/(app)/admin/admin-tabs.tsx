'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { Icon } from '@/components/icons'

export type AdminSection = { href: string; label: string; icon: string; group: string }

/** Section switcher shown on every administration page (only sections the user may open). */
export function AdminTabs({ sections }: { sections: AdminSection[] }) {
  const path = usePathname()
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (el && nav.current) nav.current.scrollLeft = el.offsetLeft - nav.current.clientWidth / 2 + el.clientWidth / 2
  }, [path])
  if (sections.length < 2) return null
  const groups = [...new Set(sections.map((s) => s.group))]
  return (
    <nav ref={nav} aria-label="Administration sections" className="relative mb-6 -mx-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex min-w-full items-center gap-1 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200/70">
        {groups.map((g, gi) => (
          <div key={g} className="flex items-center gap-1">
            {gi > 0 && <span aria-hidden className="mx-1 h-6 w-px bg-slate-200" />}
            <span className="sr-only">{g}</span>
            {sections.filter((s) => s.group === g).map((s) => {
              const active = path === s.href || path.startsWith(s.href + '/')
              return (
                <Link key={s.href} href={s.href} aria-current={active ? 'page' : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-[13px] font-medium no-underline hover:no-underline max-lg:min-h-10 ${
                    active ? 'bg-navy-950 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                  <Icon name={s.icon} className={`h-4 w-4 ${active ? 'text-cyan-brand' : 'text-slate-400'}`} />{s.label}
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}
