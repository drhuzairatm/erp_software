import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDateTime, label } from '@/components/format'
import { SecureFilesCard } from '@/components/secure-files'
import { Badge, Card, PageHeader, PriorityBadge } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { getMeeting } from '@/services/meetings'
import { ActionPointForm, CancelMeetingButton, DecisionForm, EditMeetingForm, MinutesForm, ToTaskButton } from '../forms'

export const metadata: Metadata = { title: 'Meeting' }
const parts = (d: Date) => { const s = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }).format(new Date(d)); return { date: s.slice(0, 10), time: s.slice(11, 16) } }

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireUser()
  const data = await getMeeting(ctx, id)
  if (!data) notFound()
  const { meeting: m, minutes, attendees, decisions, actions, versions, staff } = data
  const editable = m.can_edit && m.status !== 'cancelled'
  return (
    <>
      <PageHeader back={{ href: '/meetings', label: 'Meetings' }} title={m.title} description={<span className="flex flex-wrap items-center gap-2">{fmtDateTime(m.scheduled_at)}{m.location ? ` · ${m.location}` : ''} · {m.org_name}<Badge tone={m.status === 'cancelled' ? 'slate' : 'blue'}>{label(m.status)}</Badge></span>}
        actions={editable ? <CancelMeetingButton id={m.id} /> : undefined} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {m.agenda && <Card title="Agenda"><p className="whitespace-pre-wrap text-sm wrap-anywhere">{m.agenda}</p></Card>}
          <Card title={minutes ? `Minutes (version ${minutes.version})` : 'Minutes'}>
            {minutes ? <><p className="whitespace-pre-wrap text-sm wrap-anywhere" data-testid="minutes-text">{minutes.discussion_notes}</p><p className="mt-2 text-xs text-slate-500">Last saved {fmtDateTime(minutes.updated_at)}{minutes.editor ? ` by ${minutes.editor}` : ''}</p></> : <p className="hint">No minutes recorded yet.</p>}
            {editable && <div className="mt-4 border-t border-slate-100 pt-4"><MinutesForm id={m.id} notes={minutes?.discussion_notes} hasMinutes={!!minutes} /></div>}
          </Card>
          <Card title="Decisions">
            {decisions.length === 0 ? <p className="hint">No decisions recorded.</p> : <ol className="list-decimal space-y-2 pl-5 text-sm">{decisions.map((d) => <li key={d.id} className="wrap-anywhere">{d.body}<span className="block text-xs text-slate-500">{d.author} · {fmtDateTime(d.created_at)}</span></li>)}</ol>}
            {editable && <div className="mt-4 border-t border-slate-100 pt-4"><DecisionForm id={m.id} /></div>}
          </Card>
          <Card title="Action points">
            {actions.length === 0 ? <p className="hint">No action points yet.</p> : <ul className="divide-y divide-slate-100 text-sm">{actions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="action-point"><span className="min-w-0"><span className="wrap-anywhere">{a.description}</span>
                <span className="block text-xs text-slate-500">{a.responsible ?? 'No one responsible yet'}{a.deadline ? ` · due ${fmtDateTime(a.deadline)}` : ''}</span></span>
                <span className="flex items-center gap-2"><PriorityBadge priority={a.priority} />
                  {a.task_id ? <Link className="btn-secondary btn-sm" href={`/tasks/${a.task_id}`}>Open task ({label(a.task_status ?? '')})</Link> : editable && <ToTaskButton meetingId={m.id} actionId={a.id} />}</span></li>))}</ul>}
            {editable && <div className="mt-4 border-t border-slate-100 pt-4"><ActionPointForm id={m.id} people={staff} decisions={decisions} /></div>}
          </Card>
          <SecureFilesCard ctx={ctx} title="Attachments" contextType="meeting" contextId={m.id} path={`/meetings/${m.id}`} />
        </div>
        <div className="space-y-6">
          <Card title="Attendees">
            {attendees.length === 0 ? <p className="hint">No attendees listed.</p> : <ul className="space-y-1 text-sm">{attendees.map((a) => <li key={a.user_id}>{a.full_name}</li>)}</ul>}
            <p className="mt-3 text-xs text-slate-500">Note taker: {m.note_taker ?? 'None'}</p>
          </Card>
          {editable && <details className="card p-4"><summary className="cursor-pointer font-semibold">Edit meeting</summary><div className="mt-4"><EditMeetingForm id={m.id} people={staff} v={{ title: m.title, meeting_type: m.meeting_type, ...parts(m.scheduled_at), location: m.location, agenda: m.agenda, note_taker_id: m.note_taker_id, attendees: attendees.map((a) => a.user_id) }} /></div></details>}
          <Card title="Edit history">
            {versions.length === 0 ? <p className="hint">No versions yet.</p> : <ul className="space-y-3 text-sm">{versions.map((v) => (
              <li key={v.id}><details><summary className="cursor-pointer">Version {v.version} · {fmtDateTime(v.edited_at)}</summary><p className="mt-1 text-xs text-slate-500">{v.editor}{v.edit_reason ? ` · ${v.edit_reason}` : ''}</p><p className="mt-1 whitespace-pre-wrap text-xs wrap-anywhere">{v.discussion_notes}</p></details></li>))}</ul>}
          </Card>
        </div>
      </div>
    </>
  )
}
