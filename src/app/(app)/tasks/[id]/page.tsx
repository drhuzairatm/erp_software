import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDate, fmtDateTime, label } from '@/components/format'
import { Icon } from '@/components/icons'
import { Alert, Avatar, Card, DL, PageHeader, PriorityBadge, StatusBadge, staffPhotoUrl } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { staffPhotoVersions } from '@/server/services/staff-photos'
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
  const photos = await staffPhotoVersions(ctx, [t.assigned_to, ...data.comments.map((c) => c.author_id)])
  return (
    <>
      <PageHeader title={t.title} back={{ href: '/tasks', label: 'Tasks' }}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={t.status} /><PriorityBadge priority={t.priority} />{t.is_overdue && <span className="font-semibold text-red-700">Overdue</span>}<span>{t.org_name}</span></span>} />
      {created && <div className="mb-4"><Alert tone="green">Task created.</Alert></div>}
      <section aria-label="Task summary" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {([
          ['Assigned to', t.assignee_name ? <span key="a" className="flex items-center gap-2"><Avatar name={t.assignee_name} size="sm" src={staffPhotoUrl(t.assigned_to, photos[t.assigned_to ?? ''])} />{t.assignee_name}</span> : <span key="a" className="text-amber-700">Unassigned</span>, 'staff'],
          ['Due', <span key="d" className={t.is_overdue ? 'text-red-700' : ''}>{t.due_date ? fmtDate(t.due_date) : 'No due date'}</span>, 'clock'],
          ['Type', label(t.task_type), 'tasks'],
          ['Student', t.student_id ? (t.student_code ? <Link key="s" href={`/students/${t.student_id}`}>{t.student_name}</Link> : 'Restricted') : '—', 'students'],
        ] as const).map(([k, v, icon]) => (
          <div key={k} className="card flex items-start gap-3 p-4">
            <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon name={icon} className="h-5 w-5" /></span>
            <div className="min-w-0"><p className="text-xs font-medium text-slate-500">{k}</p><div className="truncate text-sm font-semibold text-slate-900">{v}</div></div>
          </div>))}
      </section>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Details">
            <DL items={[
              ['Student', t.student_id ? (t.student_code ? <Link key="s" href={`/students/${t.student_id}`}>{t.student_name} ({t.student_code})</Link> : 'Restricted') : '—'],
              ['Type', label(t.task_type)], ['Assigned to', t.assignee_name ?? 'Unassigned'], ['Created by', t.creator_name ?? 'System (automatic)'],
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
                <li key={c.id} className="flex gap-3 text-sm"><Avatar name={c.author} size="sm" src={staffPhotoUrl(c.author_id, photos[c.author_id ?? ''])} />
                  <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-slate-50 px-4 py-2.5 ring-1 ring-slate-100">
                    <p className="text-xs text-slate-500"><span className="font-semibold text-slate-700">{c.author}</span> · {fmtDateTime(c.created_at)}</p>
                    <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p></div></li>))}
              </ul>
            )}
            <CommentForm id={t.id} />
          </Card>
        </div>
        <Card title="History">
          <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5 text-sm">
            {data.events.map((e) => (
              <li key={e.id} className="relative">
                <span aria-hidden className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500 ring-2 ring-brand-100" />
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
