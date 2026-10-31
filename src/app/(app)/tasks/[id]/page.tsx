import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDate, fmtDateTime, label } from '@/components/format'
import { Alert, Card, DL, PageHeader, PriorityBadge, StatusBadge } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { getTask } from '@/server/services/tasks'
import { CommentForm, UpdateTaskForm } from '../task-forms'

export const metadata: Metadata = { title: 'Task' }

const EVENT_TEXT: Record<string, string> = {
  created: 'Created', assigned: 'Assigned to', reassigned: 'Reassigned', status: 'Status changed', due_date: 'Due date changed',
  priority: 'Priority changed', delay_reason: 'Delay reason changed', comment: 'Commented',
}

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params
  const { created } = await searchParams
  const ctx = await requireUser()
  const data = await getTask(ctx, id)
  if (!data) notFound()
  const { task: t, permissions } = data
  return (
    <>
      <PageHeader title={t.title} back={{ href: '/tasks', label: 'Tasks' }}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={t.status} /><PriorityBadge priority={t.priority} />{t.is_overdue && <span className="font-semibold text-red-700">Overdue</span>}<span>{t.org_name}</span></span>} />
      {created && <div className="mb-4"><Alert tone="green">Task created.</Alert></div>}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Details">
            <DL items={[
              ['Student', t.student_id ? (t.student_code ? <Link key="s" href={`/students/${t.student_id}`}>{t.student_name} ({t.student_code})</Link> : 'Restricted') : '—'],
              ['Type', label(t.task_type)], ['Assigned to', t.assignee_name ?? 'Unassigned'], ['Created by', t.creator_name],
              ['Created', fmtDateTime(t.created_at)], ['Due', fmtDate(t.due_date)],
              ['Waiting on / delay', t.delay_reason ? `${label(t.delay_reason)}${t.delay_note ? ` – ${t.delay_note}` : ''}` : null],
              ['Completed', t.completed_at ? fmtDateTime(t.completed_at) : null],
            ]} />
            {t.description && <p className="mt-4 whitespace-pre-wrap text-sm">{t.description}</p>}
          </Card>
          {permissions.update && (
            <Card title="Update">
              <UpdateTaskForm id={t.id} status={t.status} delayReason={t.delay_reason} delayNote={t.delay_note} priority={t.priority}
                dueDate={t.due_date} assignedTo={t.assigned_to} canReassign={permissions.reassign} staff={data.staff} />
            </Card>
          )}
          <Card title="Comments">
            {data.comments.length === 0 ? <p className="text-sm text-slate-500">No comments yet.</p> : (
              <ul className="mb-4 space-y-3">{data.comments.map((c) => (
                <li key={c.id} className="text-sm"><p className="text-xs text-slate-500">{c.author} · {fmtDateTime(c.created_at)}</p><p className="whitespace-pre-wrap">{c.body}</p></li>))}
              </ul>
            )}
            <CommentForm id={t.id} />
          </Card>
        </div>
        <Card title="History">
          <ol className="space-y-2 text-sm">
            {data.events.map((e) => (
              <li key={e.id}>
                <p className="text-xs text-slate-500">{fmtDateTime(e.occurred_at)} · {e.actor ?? 'System'}</p>
                <p>{EVENT_TEXT[e.event_type] ?? e.event_type}{e.event_type !== 'comment' && e.event_type !== 'created' && (
                  <>: {e.from_value ? `${label(e.from_value)} → ` : ''}<strong>{label(e.to_value) }</strong></>)}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  )
}
