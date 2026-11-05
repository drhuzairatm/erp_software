import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDateTime, label } from '@/components/format'
import { Badge, Card, EmptyState, PageHeader, Pagination } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { listMeetings, meetingFormData } from '@/services/meetings'
import { getScope } from '@/services/scope'
import { NewMeetingForm } from './forms'

export const metadata: Metadata = { title: 'Meetings' }

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; page?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const scope = await getScope(ctx)
  const [data, form] = await Promise.all([listMeetings(ctx, scope.orgIds, sp), meetingFormData(ctx)])
  return (
    <>
      <PageHeader title="Meetings" description="Private to the Core Team, attendees and the note taker."
        actions={form.orgs.length ? <Link className="btn-secondary" href="/meetings/core-team">Core Team</Link> : undefined} />
      {form.orgs.length > 0 && <details className="card mb-6 p-4"><summary className="cursor-pointer font-semibold">New meeting</summary><div className="mt-4"><NewMeetingForm orgs={form.orgs} staff={form.staff} /></div></details>}
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <div><label className="label" htmlFor="mq">Search by title</label><input className="input" id="mq" name="q" defaultValue={sp.q} /></div>
        <div><label className="label" htmlFor="mv">Show</label><select className="input" id="mv" name="view" defaultValue={sp.view ?? ''}><option value="">All</option><option value="upcoming">Upcoming</option><option value="past">Past</option></select></div>
        <button className="btn-primary">Apply</button>
      </form>
      <Card>
        {data.rows.length === 0 ? <EmptyState title="No meetings" /> : <ul className="divide-y divide-slate-100">{data.rows.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span className="min-w-0"><Link className="font-medium wrap-anywhere" href={`/meetings/${m.id}`}>{m.title}</Link>
              <span className="block text-xs text-slate-500">{m.org_name} · {fmtDateTime(m.scheduled_at)} · {m.attendee_count} attendee{m.attendee_count === 1 ? '' : 's'}{m.note_taker ? ` · notes by ${m.note_taker}` : ''}</span></span>
            <span className="flex items-center gap-2">{m.status === 'cancelled' ? <Badge tone="slate">Cancelled</Badge> : m.has_minutes ? <Badge tone="green">Minutes recorded</Badge> : <Badge tone="amber">{label(m.status)}</Badge>}</span>
          </li>))}</ul>}
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} params={{ view: sp.view, q: sp.q }} />
    </>
  )
}
