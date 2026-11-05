import type { Metadata } from 'next'
import { Card, PageHeader } from '@/components/ui'
import { can } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { coreTeam } from '@/services/meetings'
import { CoreTeamToggle } from '../forms'

export const metadata: Metadata = { title: 'Core Team' }

export default async function CoreTeamPage() {
  const ctx = await requireUser()
  const orgs = ctx.memberships.filter((m) => can(ctx, 'meetings.manage', m.orgId))
  if (!orgs.length) return <PageHeader title="Core Team" description="You do not have access to this page." />
  const lists = await Promise.all(orgs.map(async (o) => ({ org: o, people: await coreTeam(ctx, o.orgId) })))
  return (
    <>
      <PageHeader back={{ href: '/meetings', label: 'Meetings' }} title="Core Team" description="Members can read every meeting of their company. Changes are recorded in the audit log." />
      <div className="space-y-6">{lists.map(({ org, people }) => (
        <Card key={org.orgId} title={org.orgName}><ul className="divide-y divide-slate-100 text-sm">{people.map((p) => (
          <li key={p.user_id} className="flex items-center justify-between gap-2 py-2"><span>{p.full_name}{p.job_title && <span className="text-xs text-slate-500"> · {p.job_title}</span>}{p.member && <span className="ml-2 text-xs font-semibold text-teal-700">Core Team</span>}</span><CoreTeamToggle orgId={org.orgId} userId={p.user_id} member={p.member} /></li>))}</ul></Card>))}</div>
    </>
  )
}
