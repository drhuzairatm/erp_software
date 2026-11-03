import type { Metadata } from 'next'
import Link from 'next/link'
import { Alert, Card, EmptyState, PageHeader, Pagination } from '@/components/ui'
import { can, canAny } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { channelStatus, EVENTS, listMessages } from '@/services/notifications'
import { getScope } from '@/services/scope'
import { ProcessNowButton } from './message-forms'
import { MessageTable, STATUS_LABEL } from './message-table'

export const metadata: Metadata = { title: 'Messages' }

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireUser()
  const scope = await getScope(ctx)
  if (!scope.orgIds.some((o) => can(ctx, 'notifications.view', o))) return <PageHeader title="Messages" description="You do not have access to the message outbox." />
  const sp = await searchParams
  const orgIds = scope.orgIds.filter((o) => can(ctx, 'notifications.view', o))
  const data = await listMessages(ctx, orgIds, sp)
  const status = channelStatus(ctx.memberships.filter((m) => orgIds.includes(m.orgId)).map((m) => m.orgCode))
  return (
    <>
      <PageHeader title="Messages (email / WhatsApp / SMS)" description={`${scope.label} · every message the system generated, and what happened to it.`}
        actions={<>{canAny(ctx, ['notifications.manage']) && <Link className="btn-secondary" href="/admin/notifications">Notification settings</Link>}<ProcessNowButton /></>} />
      <div className="mb-4">
        {status.mode === 'test'
          ? <Alert tone="amber" title="Test mode">No message is sent to students or parents. Messages are kept here as “Test – not sent” so you can check the wording. Only addresses in the test list receive real messages.</Alert>
          : <Alert tone="green" title="Live mode">Messages are sent to students/parents who have given consent.</Alert>}
      </div>
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div><label className="label" htmlFor="status">Status</label><select className="input" id="status" name="status" defaultValue={sp.status ?? ''}><option value="">Any</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label" htmlFor="channel">Channel</label><select className="input" id="channel" name="channel" defaultValue={sp.channel ?? ''}><option value="">Any</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="sms">SMS</option></select></div>
        <div><label className="label" htmlFor="event">Event</label><select className="input" id="event" name="event" defaultValue={sp.event ?? ''}><option value="">Any</option>{EVENTS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select></div>
        <button className="btn-primary" type="submit">Apply</button><Link className="btn-ghost" href="/notifications">Clear</Link>
      </form>
      <Card padded={false}>
        {data.rows.length === 0 ? <EmptyState title="No messages yet">Messages appear here when notification rules are switched on and events happen.</EmptyState> : <MessageTable rows={data.rows} back="/notifications" />}
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} params={sp} />
      </Card>
    </>
  )
}

