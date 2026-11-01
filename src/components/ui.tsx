import Link from 'next/link'
import { LEVELS, LevelIcon } from './notice'
import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && <Link href={back.href} className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 no-underline hover:text-brand-700 hover:no-underline">← {back.label}</Link>}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">{title}</h1>
          {description && <div className="mt-1 text-sm text-slate-600">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function Card({ title, actions, children, className = '', padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          {title && <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

const TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  green: 'bg-green-50 text-green-700 ring-green-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200',
  orange: 'bg-orange-50 text-orange-800 ring-orange-200',
} as const
export type Tone = keyof typeof TONES

export function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>
}

const STATUS: Record<string, [string, Tone]> = {
  // student status
  active: ['Active', 'blue'], on_hold: ['On hold', 'amber'], completed: ['Completed', 'green'], cancelled: ['Cancelled', 'slate'], merged: ['Merged', 'purple'],
  // documents
  missing: ['Missing', 'slate'], uploaded: ['Uploaded – pending review', 'blue'], under_review: ['Under review', 'purple'], approved: ['Approved', 'green'], rejected: ['Rejected', 'red'], expired: ['Expired', 'red'],
  changes_required: ['Changes required', 'amber'], pending_approval: ['Pending manager approval', 'purple'],
  // tasks
  not_started: ['Not started', 'slate'], in_progress: ['In progress', 'blue'], waiting_external: ['Waiting on external', 'amber'],
  // payments
  not_required: ['Charge', 'slate'], pending: ['Awaiting verification', 'amber'], verified: ['Verified', 'green'],
  // visa
  not_applied: ['Not applied', 'slate'],
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const [l, tone] = STATUS[status] ?? [status.replace(/_/g, ' '), 'slate' as Tone]
  return <Badge tone={tone}>{label ?? l}</Badge>
}

const PRIORITY: Record<string, Tone> = { low: 'slate', normal: 'blue', high: 'amber', urgent: 'red' }
export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY[priority] ?? 'slate'}>{priority[0].toUpperCase() + priority.slice(1)}</Badge>
}

export function DemoBadge() {
  return <Badge tone="purple">DEMO</Badge>
}

export function Alert({ tone = 'blue', title, children }: { tone?: 'blue' | 'green' | 'amber' | 'red'; title?: ReactNode; children?: ReactNode }) {
  const level = ({ blue: 'info', green: 'success', amber: 'warning', red: 'critical' } as const)[tone]
  const cls = { blue: 'border-blue-200 bg-blue-50 text-blue-900', green: 'border-green-200 bg-green-50 text-green-900', amber: 'border-amber-200 bg-amber-50 text-amber-900', red: 'border-red-200 bg-red-50 text-red-900' }[tone]
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className={`flex gap-2 rounded-md border px-4 py-3 text-sm ${cls}`}>
      <LevelIcon level={level} className="mt-0.5 h-4 w-4" />
      <div className="min-w-0 flex-1">
        <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-75">{LEVELS[level].label}</span>
        {title && <span className="font-medium">{title}</span>}
        {children && <div className={title ? "mt-1" : "inline"}>{children}</div>}
      </div>
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <div aria-hidden className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" /></svg>
      </div>
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  )
}

export function Field({ label, name, error, hint, required, children }: { label: string; name: string; error?: string[]; hint?: ReactNode; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={name} className="label">
        {label} {required && <span className="text-red-600" aria-hidden>*</span>}
      </label>
      {children}
      {hint && !error && <p className="hint" id={`${name}-hint`}>{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600" id={`${name}-error`}>{error.join(' ')}</p>}
    </div>
  )
}

export function DL({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{v ?? <span className="text-slate-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Pagination({ page, total, pageSize, params }: { page: number; total: number; pageSize: number; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const href = (p: number) => '?' + new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>, page: String(p) }).toString()
  const from = total ? (page - 1) * pageSize + 1 : 0
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
      <span>{total ? `Showing ${from}–${Math.min(page * pageSize, total)} of ${total}` : 'No results'}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="btn-secondary btn-sm" href={href(page - 1)}>Previous</Link> : <span className="btn-secondary btn-sm opacity-50" aria-disabled>Previous</span>}
        {page < pages ? <Link className="btn-secondary btn-sm" href={href(page + 1)}>Next</Link> : <span className="btn-secondary btn-sm opacity-50" aria-disabled>Next</span>}
      </div>
    </nav>
  )
}

const STAT_TONES: Record<string, { bar: string; icon: string; ring: string }> = {
  slate: { bar: 'from-slate-300 to-slate-400', icon: 'bg-slate-100 text-slate-600', ring: 'hover:ring-slate-200' },
  blue: { bar: 'from-blue-400 to-blue-600', icon: 'bg-blue-50 text-blue-600', ring: 'hover:ring-blue-200' },
  green: { bar: 'from-emerald-400 to-green-600', icon: 'bg-green-50 text-green-600', ring: 'hover:ring-green-200' },
  amber: { bar: 'from-amber-300 to-amber-500', icon: 'bg-amber-50 text-amber-600', ring: 'hover:ring-amber-200' },
  red: { bar: 'from-rose-400 to-red-600', icon: 'bg-red-50 text-red-600', ring: 'hover:ring-red-200' },
  purple: { bar: 'from-violet-400 to-purple-600', icon: 'bg-purple-50 text-purple-600', ring: 'hover:ring-purple-200' },
  orange: { bar: 'from-orange-300 to-orange-500', icon: 'bg-orange-50 text-orange-600', ring: 'hover:ring-orange-200' },
}
export function StatCard({ label, value, href, tone = 'slate', sub, icon, chart }: { label: string; value: ReactNode; href?: string; tone?: Tone; sub?: ReactNode; icon?: ReactNode; chart?: ReactNode }) {
  const t = STAT_TONES[tone]
  const body = (
    <>
      <span aria-hidden className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.bar}`} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium leading-snug text-slate-600">{label}</p>
        {icon && <span aria-hidden className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${t.icon}`}>{icon}</span>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-[26px] font-bold leading-none tabular-nums tracking-tight text-slate-900">{value}</p>
        {chart}
      </div>
      {sub && <p className="mt-1.5 text-xs text-slate-500">{sub}</p>}
    </>
  )
  const cls = `card relative block overflow-hidden px-4 pb-3.5 pt-4 transition ring-1 ring-transparent ${t.ring}`
  return href ? <Link href={href} className={`${cls} no-underline hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] hover:no-underline`}>{body}</Link> : <div className={cls}>{body}</div>
}

/** Pill tabs for list views (links), with optional counts. */
export function ViewTabs({ label, items }: { label: string; items: { href: string; label: string; active: boolean; count?: number; alert?: boolean }[] }) {
  return (
    <nav aria-label={label} className="mb-4 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? 'page' : undefined}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium no-underline transition hover:no-underline ${
            i.active ? 'bg-navy-950 text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
          {i.label}
          {i.count !== undefined && (
            <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
              i.active ? 'bg-white/15 text-white' : i.alert && i.count > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{i.count}</span>
          )}
        </Link>
      ))}
    </nav>
  )
}

const AVATAR_COLORS = ['from-sky-400 to-blue-600', 'from-teal-300 to-emerald-600', 'from-violet-400 to-purple-600', 'from-amber-300 to-orange-500', 'from-rose-300 to-pink-600', 'from-cyan-300 to-sky-600']
/** Round avatar: the photo when one exists (served by an authorised route), otherwise initials. */
export function Avatar({ name, size = 'md', src }: { name: string | null | undefined; size?: 'sm' | 'md' | 'lg' | 'xl'; src?: string | null }) {
  const n = (name ?? '?').replace(/\(.*?\)/g, '').trim()
  const dim = { sm: 'h-7 w-7 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm', xl: 'h-20 w-20 text-2xl' }[size]
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" aria-hidden className={`${dim} shrink-0 rounded-full bg-slate-100 object-cover ring-1 ring-black/5`} loading="lazy" />
  }
  const initials = n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
  const c = AVATAR_COLORS[[...n].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_COLORS.length]
  return <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white ${c} ${dim}`}>{initials}</span>
}

/** URL of a student's avatar thumbnail (authorised, private; the version busts the cache after a change). */
export const studentPhotoUrl = (studentId: string, version: number | null | undefined) =>
  version ? `/api/students/${studentId}/photo?size=thumb&v=${version}` : null

/** Filter bar wrapper for GET forms. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4">{children}</form>
}
