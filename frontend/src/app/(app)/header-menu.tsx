'use client'

import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useRef } from 'react'

/**
 * Header dropdown. Closes on an outside tap, on Escape and after navigation. Below `sm` the panel spans the header
 * (positioned against the sticky header, not this button), so it always stays inside the viewport.
 */
export function HeaderMenu({ summary, summaryClassName, summaryLabel, panelClassName, children }: {
  summary: ReactNode; summaryClassName: string; summaryLabel?: string; panelClassName: string; children: ReactNode
}) {
  const menu = useRef<HTMLDetailsElement>(null)
  const path = usePathname()
  useEffect(() => { if (menu.current) menu.current.open = false }, [path])
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const d = menu.current
      if (d?.open && !d.contains(e.target as Node)) d.open = false
    }
    const onKey = (e: KeyboardEvent) => {
      const d = menu.current
      if (e.key === 'Escape' && d?.open) { d.open = false; d.querySelector('summary')?.focus() }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [])
  return (
    <details ref={menu} className="relative max-sm:static">
      <summary className={summaryClassName} aria-label={summaryLabel}>{summary}</summary>
      <div className={`card absolute z-30 mt-2 text-sm max-sm:inset-x-2 max-sm:top-full max-sm:mt-1 max-sm:max-h-[calc(100dvh-5rem)] max-sm:overflow-y-auto sm:right-0 ${panelClassName}`}
        onClick={(e) => { if ((e.target as HTMLElement).closest('a') && menu.current) menu.current.open = false }}>
        {children}
      </div>
    </details>
  )
}
