import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { fmtDateTime, label } from '@/components/format'
import { Pagination } from '@/components/ui'
import { portalSession } from '@/services/portal'
import { portalTickets, TICKET_STATUSES } from '@/services/tickets'
import { NewTicketForm } from './forms'

export const metadata: Metadata = { title: 'My questions' }

export default async function PortalTicketsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const session = await portalSession()
  if (!session?.active_student_id) redirect('/portal')
  const sp = await searchParams
  const data = await portalTickets(session.tokenHash, sp)
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link href="/portal/home" className="text-sm">← My application</Link>
      <h1 className="text-2xl font-bold">My questions</h1>
      <details className="card p-4" open={data.total === 0 && !sp.q && !sp.status}><summary className="cursor-pointer font-semibold">Ask a question</summary><div className="mt-4"><NewTicketForm /></div></details>
      <form className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1"><label className="label" htmlFor="pq">Search</label><input className="input" id="pq" name="q" defaultValue={sp.q} placeholder="Reference or subject" /></div>
        <div><label className="label" htmlFor="ps">Status</label><select className="input" id="ps" name="status" defaultValue={sp.status ?? ''}><option value="">Any</option>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <button className="btn-primary">Apply</button>
      </form>
      <section className="card p-4">
        {data.rows.length === 0 ? <p className="text-sm text-slate-600">No questions yet.</p> : <ul className="divide-y divide-slate-100">{data.rows.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span className="min-w-0"><Link className="font-medium wrap-anywhere" href={`/portal/tickets/${t.id}`}>{t.subject}</Link><span className="block text-xs text-slate-500">{t.ticket_number} · {label(t.category)} · {fmtDateTime(t.last_message_at)}</span></span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{label(t.status)}</span>
          </li>))}</ul>}
      </section>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} params={{ q: sp.q, status: sp.status }} />
    </main>
  )
}
