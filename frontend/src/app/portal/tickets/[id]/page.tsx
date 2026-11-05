import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { fmtDateTime, label } from '@/components/format'
import { portalSession } from '@/services/portal'
import { portalTicket } from '@/services/tickets'
import { StudentReplyForm } from '../forms'

export const metadata: Metadata = { title: 'My question' }

export default async function PortalTicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const session = await portalSession()
  if (!session?.active_student_id) redirect('/portal')
  const { id } = await params
  const sp = await searchParams
  const t = await portalTicket(session.tokenHash, id)
  if (!t) notFound()
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link href="/portal/tickets" className="text-sm">← My questions</Link>
      {sp.new && <p role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">We received your question. Your reference is <span className="font-mono font-semibold">{t.ticket_number}</span>.</p>}
      <header><h1 className="text-2xl font-bold wrap-anywhere">{t.subject}</h1><p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600"><span className="font-mono">{t.ticket_number}</span> · {label(t.category)} · <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{label(t.status)}</span></p></header>
      <ol className="space-y-3">{t.messages.map((m) => (
        <li key={m.id} className={`card p-4 text-sm ${m.from === 'staff' ? 'border-blue-200 bg-blue-50' : ''}`} data-testid="ticket-message">
          <p className="text-xs font-semibold text-slate-600">{m.from === 'staff' ? 'Our team' : 'You'} · {fmtDateTime(m.at)}</p>
          <p className="mt-1 whitespace-pre-wrap wrap-anywhere">{m.body}</p>
          {m.files.map((f) => <p key={f.id} className="mt-2"><a href={`/portal/tickets/files/${f.id}`} className="wrap-anywhere">{f.name}</a></p>)}
        </li>))}</ol>
      {t.status === 'closed' ? <p className="card p-4 text-sm text-slate-600">This question is closed. <Link href="/portal/tickets">Ask a new one</Link> if you need more help.</p> : <section className="card p-4"><StudentReplyForm id={t.id} /></section>}
      <details className="card p-4 text-sm"><summary className="cursor-pointer font-semibold">History</summary><ul className="mt-2 space-y-1 text-xs text-slate-600">{t.history.map((h, i) => <li key={i}>{fmtDateTime(h.at)} · {label(h.to)}</li>)}</ul></details>
    </main>
  )
}
