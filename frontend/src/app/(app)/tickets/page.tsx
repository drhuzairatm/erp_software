import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDateTime, label } from '@/components/format'
import { Badge, Card, EmptyState, PageHeader, Pagination } from '@/components/ui'
import { canAny } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { getScope } from '@/services/scope'
import { listTickets, TICKET_CATEGORIES, TICKET_STATUSES } from '@/services/tickets'

export const metadata: Metadata = { title: 'Student questions' }
const TONE: Record<string, 'blue' | 'amber' | 'green' | 'slate'> = { open: 'blue', in_progress: 'blue', waiting_for_student: 'amber', resolved: 'green', closed: 'slate' }

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ view?: string; status?: string; category?: string; q?: string; page?: string }> }) {
  const ctx = await requireUser()
  if (!canAny(ctx, ['tickets.respond', 'tickets.manage'])) notFound()
  const sp = await searchParams
  const scope = await getScope(ctx)
  const data = await listTickets(ctx, scope.orgIds, sp)
  return (
    <>
      <PageHeader title="Student questions" description="Questions asked through the student portal, for students you can see." />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <div><label className="label" htmlFor="tq">Search</label><input className="input" id="tq" name="q" defaultValue={sp.q} placeholder="Reference, subject, student" /></div>
        <div><label className="label" htmlFor="tv">Show</label><select className="input" id="tv" name="view" defaultValue={sp.view ?? ''}><option value="">All I can see</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option><option value="waiting">Waiting for us</option></select></div>
        <div><label className="label" htmlFor="ts">Status</label><select className="input" id="ts" name="status" defaultValue={sp.status ?? ''}><option value="">Any</option>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className="label" htmlFor="tc">Category</label><select className="input" id="tc" name="category" defaultValue={sp.category ?? ''}><option value="">Any</option>{TICKET_CATEGORIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <button className="btn-primary">Apply</button>
      </form>
      <Card>
        {data.rows.length === 0 ? <EmptyState title="No questions" /> : <ul className="divide-y divide-slate-100">{data.rows.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span className="min-w-0"><Link className="font-medium wrap-anywhere" href={`/tickets/${t.id}`}><span className="font-mono">{t.ticket_number}</span> · {t.subject}</Link>
              <span className="block text-xs text-slate-500 wrap-anywhere">{t.student_name} ({t.student_code}) · {t.org_name} · {label(t.category)} · {t.assignee ?? 'Unassigned'} · {fmtDateTime(t.last_message_at)}</span></span>
            <span className="flex flex-wrap items-center gap-2">{t.last_from === 'student' && !['resolved', 'closed'].includes(t.status) && <Badge tone="amber">Waiting for us</Badge>}<Badge tone={TONE[t.status] ?? 'slate'}>{label(t.status)}</Badge></span>
          </li>))}</ul>}
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} params={{ view: sp.view, status: sp.status, category: sp.category, q: sp.q }} />
    </>
  )
}
