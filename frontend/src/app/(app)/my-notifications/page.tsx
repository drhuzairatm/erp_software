import type { Metadata } from 'next'
import Link from 'next/link'
import { markAllNotificationsReadAction, openNotificationAction } from '@/app/actions/staff-notifications'
import { fmtDateTime } from '@/components/format'
import { Badge, Card, EmptyState, PageHeader, Pagination } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { listMyNotifications } from '@/services/staff-notifications'

export const metadata: Metadata = { title: 'My notifications' }

export default async function MyNotificationsPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const unreadOnly = sp.view === 'unread'
  const data = await listMyNotifications(ctx, { unread: unreadOnly, page: sp.page })
  return (
    <>
      <PageHeader title="My notifications" description={data.unread ? `${data.unread} unread` : 'Nothing unread'}
        actions={data.unread > 0 ? <form action={markAllNotificationsReadAction}><button className="btn-secondary">Mark all as read</button></form> : undefined} />
      <nav aria-label="Filter notifications" className="mb-4 flex gap-2 text-sm">
        <Link className={!unreadOnly ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} href="/my-notifications">All</Link>
        <Link className={unreadOnly ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} href="/my-notifications?view=unread">Unread</Link>
        <Link className="btn-ghost btn-sm ml-auto" href="/my-notifications/preferences">Preferences</Link>
      </nav>
      <Card>
        {data.rows.length === 0 ? <EmptyState title={unreadOnly ? 'Nothing unread' : 'No notifications yet'} /> : (
          <ul className="divide-y divide-slate-100">
            {data.rows.map((n) => (
              <li key={n.id}>
                <form action={openNotificationAction.bind(null, n.id)}>
                  <button className="flex w-full flex-wrap items-center justify-between gap-2 px-2 py-3 text-left text-sm hover:bg-slate-50">
                    <span className="min-w-0">
                      <span className={n.read_at ? 'text-slate-600' : 'font-semibold text-slate-900'}>{n.title}</span>
                      {n.detail && <span className="block text-slate-500 wrap-anywhere">{n.detail}</span>}
                      <span className="block text-xs text-slate-500">{n.org_name} · {fmtDateTime(n.created_at)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {n.severity === 'critical' && <Badge tone="red">Critical</Badge>}
                      {n.severity === 'warning' && <Badge tone="amber">Attention</Badge>}
                      {!n.read_at && <Badge tone="blue">Unread</Badge>}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} params={{ view: unreadOnly ? 'unread' : undefined }} />
    </>
  )
}
