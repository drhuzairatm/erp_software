'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { Icon } from '@/components/icons'

export interface NavItem { href: string; label: string; icon: string; group: string }

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname()
  const groups = [...new Set(items.map((i) => i.group))]
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{g}</p>
          <ul className="space-y-0.5">
            {items.filter((i) => i.group === g).map((i) => {
              const active = i.href === '/' ? path === '/' : path === i.href || path.startsWith(i.href + '/')
              return (
                <li key={i.href}>
                  <Link href={i.href} aria-current={active ? 'page' : undefined} onClick={onNavigate}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm max-lg:min-h-10 font-medium no-underline transition hover:no-underline ${
                      active ? 'bg-cyan-brand/10 text-cyan-brand' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>
                    {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-cyan-brand shadow-[0_0_12px_#36D9FF]" />}
                    <Icon name={i.icon} className={`h-[18px] w-[18px] ${active ? 'text-cyan-brand' : 'text-slate-400 group-hover:text-white'}`} />
                    <span className="truncate">{i.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** Navy sidebar: fixed on large screens, slide-in drawer on phones and tablets. */
export function Sidebar({ items, header, footer }: { items: NavItem[]; header: ReactNode; footer?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const path = usePathname()
  const [lastPath, setLastPath] = useState(path)
  if (path !== lastPath) { setLastPath(path); setOpen(false) } // close the drawer after navigation
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  // the page behind the open drawer must not scroll; restored when it closes
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])
  const panel = (
    <div className="flex h-full flex-col bg-navy-950 text-slate-200">
      <div className="border-b border-white/10 px-5 py-5">{header}</div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto overscroll-contain px-3 py-5"><NavList items={items} onNavigate={() => setOpen(false)} /></nav>
      {footer && <div className="border-t border-white/10 px-5 py-4 text-xs text-slate-400">{footer}</div>}
    </div>
  )
  return (
    <>
      <button type="button" className="fixed left-[calc(0.75rem+env(safe-area-inset-left))] top-[calc(0.75rem+env(safe-area-inset-top))] z-40 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-navy-950 text-white shadow-lg lg:hidden"
        aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" /></button>
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block lg:w-64">{panel}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-navy-950 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] shadow-2xl">
            {panel}
            <button type="button" aria-label="Close menu" className="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] inline-flex items-center justify-center rounded-md p-1.5 text-slate-300 hover:bg-white/10" onClick={() => setOpen(false)}><Icon name="close" /></button>
          </div>
        </div>
      )}
    </>
  )
}

export function ScopeSelect({ options, value }: { options: { value: string; label: string }[]; value: string }) {
  const path = usePathname()
  return (
    <>
      <input type="hidden" name="back" value={path} />
      <label htmlFor="scope" className="sr-only">Company</label>
      <select id="scope" name="scope" defaultValue={value} onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-white focus:border-cyan-brand focus:outline-none focus:ring-2 focus:ring-cyan-brand/30 [&>option]:text-slate-900">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <noscript><button className="btn-secondary btn-sm mt-1" type="submit">Switch</button></noscript>
    </>
  )
}
