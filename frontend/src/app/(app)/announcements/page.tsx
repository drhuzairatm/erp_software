import type { Metadata } from 'next'
import { fmtDateTime } from '@/components/format'
import { Badge, Card, EmptyState, PageHeader, Pagination } from '@/components/ui'
import { can } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { listAnnouncements } from '@/services/staff-notifications'
import { PublishAnnouncementForm, WithdrawAnnouncementButton } from './forms'

export const metadata: Metadata = { title: 'Announcements' }

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const data = await listAnnouncements(ctx, { page: sp.page })
  const orgs = ctx.memberships.filter((m) => can(ctx, 'announcements.publish', m.orgId)).map((m) => ({ id: m.orgId, name: m.orgName }))
  return (
    <>
      <PageHeader title="Announcements" description="Messages from management to all staff of a company." />
      {orgs.length > 0 && <Card title="Publish an announcement" className="mb-6"><PublishAnnouncementForm orgs={orgs} /></Card>}
      <Card>
        {data.rows.length === 0 ? <EmptyState title="No announcements yet" /> : (
          <ul className="divide-y divide-slate-100">
            {data.rows.map((a) => (
              <li key={a.id} className={`py-3 ${a.withdrawn_at ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold wrap-anywhere">{a.title}</h2>
                  <span className="flex items-center gap-2">
                    {a.severity === 'critical' && <Badge tone="red">Critical</Badge>}{a.severity === 'warning' && <Badge tone="amber">Important</Badge>}
                    {a.withdrawn_at && <Badge tone="slate">Withdrawn</Badge>}
                    {a.can_manage && !a.withdrawn_at && <WithdrawAnnouncementButton id={a.id} />}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 wrap-anywhere">{a.body}</p>
                <p className="mt-1 text-xs text-slate-500">{a.org_name} · {a.publisher ?? 'Management'} · {fmtDateTime(a.published_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} params={{}} />
    </>
  )
}
