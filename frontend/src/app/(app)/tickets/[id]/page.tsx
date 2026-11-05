import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDateTime, label } from '@/components/format'
import { ScanBadge } from '@/components/scan-badge'
import { Badge, Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { getTicket } from '@/services/tickets'
import { AssignTicketForm, ReplyForm, StatusForm } from '../forms'

export const metadata: Metadata = { title: 'Student question' }

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser()
  const { id } = await params
  const data = await getTicket(ctx, id)
  if (!data) notFound()
  const { ticket: t, messages, files, events, staff } = data
  const closed = t.status === 'closed'
  const canAssign = !closed && (t.can_manage || t.assigned_to === ctx.userId || !t.assigned_to)
  return (
    <>
      <PageHeader title={t.subject} description={`${t.ticket_number} · ${t.org_name} · ${label(t.category)}`} back={{ href: '/tickets', label: 'Student questions' }} actions={<Badge tone={closed ? 'slate' : 'blue'}>{label(t.status)}</Badge>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card title="Conversation">
            <ol className="space-y-3">{messages.map((m) => (
              <li key={m.id} className={`rounded-md border p-3 text-sm ${m.author_type === 'staff' ? 'border-blue-200 bg-blue-50' : 'border-slate-200'}`} data-testid="ticket-message">
                <p className="text-xs font-semibold text-slate-600">{m.author_type === 'staff' ? (m.author ?? 'Staff') : `${t.student_name} (student)`} · {fmtDateTime(m.created_at)}</p>
                <p className="mt-1 whitespace-pre-wrap wrap-anywhere">{m.body}</p>
                {files.filter((f) => f.context_id === m.id).map((f) => <p key={f.id} className="mt-2 flex flex-wrap items-center gap-2"><a href={`/api/secure-files/${f.id}`} target="_blank" rel="noopener" className="wrap-anywhere">{f.original_filename}</a><ScanBadge status={f.scan_status} /></p>)}
              </li>))}</ol>
          </Card>
          {!closed && <Card title="Reply"><ReplyForm id={t.id} /></Card>}
        </div>
        <div className="min-w-0 space-y-4">
          <Card title="Student"><p className="text-sm"><Link href={`/students/${t.student_id}`}>{t.student_name}</Link><span className="block font-mono text-xs text-slate-500">{t.student_code}</span></p></Card>
          <Card title="Assigned to"><p className="mb-3 text-sm">{t.assignee ?? 'Nobody yet'}</p>{canAssign && <AssignTicketForm id={t.id} staff={staff} current={t.assigned_to} />}</Card>
          {!closed && <Card title="Status"><StatusForm id={t.id} current={t.status} /></Card>}
          <Card title="History"><ul className="space-y-2 text-xs text-slate-600">{events.map((e) => <li key={e.id} className="wrap-anywhere"><span className="font-medium text-slate-800">{label(e.action)}</span>{e.to_status && e.to_status !== e.from_status ? ` → ${label(e.to_status)}` : ''}<span className="block">{fmtDateTime(e.created_at)} · {e.by_student ? 'Student' : (e.actor ?? 'System')}</span>{e.note && <span className="block whitespace-pre-wrap text-slate-700">{e.note}</span>}</li>)}</ul></Card>
        </div>
      </div>
    </>
  )
}
