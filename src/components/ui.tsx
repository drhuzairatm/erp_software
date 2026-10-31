import Link from 'next/link'
import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && <Link href={back.href} className="text-sm text-slate-600">← {back.label}</Link>}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
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
  const cls = { blue: 'border-blue-200 bg-blue-50 text-blue-900', green: 'border-green-200 bg-green-50 text-green-900', amber: 'border-amber-200 bg-amber-50 text-amber-900', red: 'border-red-200 bg-red-50 text-red-900' }[tone]
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className={`rounded-md border px-4 py-3 text-sm ${cls}`}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
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

export function StatCard({ label, value, href, tone = 'slate', sub }: { label: string; value: ReactNode; href?: string; tone?: Tone; sub?: ReactNode }) {
  const accent = { slate: 'border-l-slate-300', blue: 'border-l-blue-500', green: 'border-l-green-500', amber: 'border-l-amber-500', red: 'border-l-red-500', purple: 'border-l-purple-500' }[tone]
  const body = (
    <>
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </>
  )
  const cls = `card block border-l-4 ${accent} px-4 py-3`
  return href ? <Link href={href} className={`${cls} no-underline hover:bg-slate-50 hover:no-underline`}>{body}</Link> : <div className={cls}>{body}</div>
}
