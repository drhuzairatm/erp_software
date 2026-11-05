import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { fmtDateTime, label } from '@/components/format'
import { Alert, Badge, Card, DL, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { ServiceError } from '@/lib/errors'
import { governanceAccess, getRequest, readRequest } from '@/services/chat-governance'
import { CloseRequest, DecideForm } from '../forms'

export const metadata: Metadata = { title: 'Investigation request' }

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ read?: string; offset?: string }> }) {
  const ctx = await requireUser()
  const { id } = await params
  const sp = await searchParams
  const data = await getRequest(ctx, id)
  if (!data) notFound()
  const { request: q } = data
  const access = (await governanceAccess(ctx)).find((a) => a.org_id === q.org_id)
  const active = q.status === 'approved' && !!q.expires_at && new Date(q.expires_at) > new Date()
  const isReader = q.reader_id === ctx.userId
  const offset = Math.max(0, Number(sp.offset) || 0)
  let read: Awaited<ReturnType<typeof readRequest>> | null = null
  let readError: string | null = null
  // Opened only by the explicit button below, never by loading this page. The database writes the log in the same transaction.
  if (sp.read === '1' && isReader) {
    try { read = await readRequest(ctx, id, offset) } catch (e) { if (e instanceof ServiceError) readError = e.message; else throw e }
  }
  const log = read ? (await getRequest(ctx, id))?.log ?? data.log : data.log
  return (
    <>
      <PageHeader title={q.reference} description="A restricted record. Every read is logged by person, time and message." back={{ href: '/chat/governance', label: 'Chat governance' }}
        actions={<span className="flex flex-wrap items-center gap-2"><Badge tone={active ? 'green' : q.status === 'pending' ? 'amber' : 'slate'}>{active ? 'Approved' : q.status === 'approved' ? 'Expired' : label(q.status)}</Badge>
          {['pending', 'approved'].includes(q.status) && (access?.approver || q.requested_by === ctx.userId || isReader) && <CloseRequest id={q.id} />}</span>} />
      <div className="space-y-6">
        <Card title="Request">
          <DL items={[['Requested by', `${q.requester}, ${fmtDateTime(q.requested_at)}`], ['Reader', q.reader], ['Scope', q.scope_user ? `Messages sent by ${q.scope_user}` : q.scope_group ? `Group: ${q.scope_group}` : 'One direct conversation'], ['Dates', `${q.from_date ?? 'Any'} to ${q.to_date ?? 'any'}`],
            ['Decided by', q.approver ? `${q.approver}, ${fmtDateTime(q.decided_at)}` : 'Not decided'], ['Access until', q.expires_at ? fmtDateTime(q.expires_at) : 'None']]} />
          <p className="mt-3 whitespace-pre-wrap text-sm wrap-anywhere"><strong>Reason:</strong> {q.reason}</p>
          {q.decision_note && <p className="mt-2 whitespace-pre-wrap text-sm wrap-anywhere"><strong>Decision:</strong> {q.decision_note}</p>}
        </Card>
        {q.status === 'pending' && access?.approver && <Card title="Decision"><DecideForm id={q.id} /></Card>}
        {isReader && active && !read && <Card title="Open the messages"><p className="hint mb-3">Opening them is recorded against your name, with the messages shown.</p><form><input type="hidden" name="read" value="1" /><button className="btn-primary">Open the messages</button></form></Card>}
        {readError && <Alert tone="red">{readError}</Alert>}
        {read && <Card title={`Messages (${offset + 1} to ${offset + read.messages.length} of ${read.total})`}>
          {read.messages.length === 0 ? <p className="text-sm text-slate-500">No messages in this scope.</p> : <ul className="divide-y divide-slate-100 text-sm" data-testid="archive-messages">{read.messages.map((m) => (
            <li key={m.id} className="py-3"><span className="text-xs text-slate-500">{m.sender} · {fmtDateTime(m.created_at)}{m.deleted_at ? ` · removed ${fmtDateTime(m.deleted_at)}` : ''}{m.edited_at ? ' · edited' : ''}</span>
              <span className="block whitespace-pre-wrap wrap-anywhere">{m.body || <em className="text-slate-500">No current text</em>}</span>
              {m.history.length > 0 && <ul className="mt-1 border-l-2 border-slate-200 pl-3 text-xs">{m.history.map((h, i) => <li key={i}><strong>{label(h.action)}</strong>, {fmtDateTime(h.at)}{h.by ? ` by ${h.by}` : ''}: <span className="whitespace-pre-wrap wrap-anywhere">{h.body}</span></li>)}</ul>}
              {m.files.map((f, i) => <span key={i} className="block text-xs text-slate-500">File: {f.name}{f.removed_at ? ' (removed)' : ''} · SHA-256 {f.sha256}</span>)}</li>))}</ul>}
          {offset + read.messages.length < read.total && <form className="mt-3"><input type="hidden" name="read" value="1" /><input type="hidden" name="offset" value={offset + read.messages.length} /><button className="btn-secondary btn-sm">Next messages</button></form>}
        </Card>}
        <Card title={`Access log (${log.length})`}>
          {log.length === 0 ? <p className="text-sm text-slate-500">Nobody has read these messages under this request.</p> : <ul className="divide-y divide-slate-100 text-sm" data-testid="access-log">{log.map((l) => (
            <li key={l.id} className="py-2">{l.accessor}, {fmtDateTime(l.accessed_at)}: {l.count} message{l.count === 1 ? '' : 's'}<details className="text-xs text-slate-500"><summary className="cursor-pointer">Message references</summary><span className="wrap-anywhere">{l.message_ids.join(', ')}</span></details></li>))}</ul>}
        </Card>
      </div>
    </>
  )
}
