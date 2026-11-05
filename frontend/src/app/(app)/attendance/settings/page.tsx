import type { Metadata } from 'next'
import { Alert, Card, PageHeader } from '@/components/ui'
import { can } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { attendanceSettings } from '@/services/attendance'
import { OfficeForm, OfficeToggle, PolicyForm } from './forms'

export const metadata: Metadata = { title: 'Attendance settings' }

export default async function AttendanceSettingsPage() {
  const ctx = await requireUser()
  const orgs = ctx.memberships.filter((m) => can(ctx, 'attendance.manage', m.orgId))
  if (!orgs.length) return <PageHeader title="Attendance settings" description="You do not have access to this page." />
  const all = await Promise.all(orgs.map(async (o) => ({ org: o, ...(await attendanceSettings(ctx, o.orgId)) })))
  return (
    <>
      <PageHeader back={{ href: '/attendance/manage', label: 'Team attendance' }} title="Attendance settings" description="Offices, working hours and which signals each company expects." />
      <Alert tone="amber" title="Check these values">The working hours, grace period and half-day limit start as placeholders. Confirm them for each company before relying on the late and half-day figures.</Alert>
      <div className="mt-6 space-y-8">{all.map(({ org, policy, offices }) => (
        <section key={org.orgId} className="space-y-4"><h2 className="text-lg font-semibold">{org.orgName}</h2>
          <Card title="Policy"><PolicyForm orgId={org.orgId} p={policy} /></Card>
          <Card title="Offices">
            <ul className="mb-4 divide-y divide-slate-100">{offices.map((o) => (
              <li key={o.id} className="py-3"><div className="mb-2 flex items-center justify-between gap-2 text-sm"><span className={o.is_active ? 'font-medium' : 'text-slate-400'}>{o.name}{!o.is_active && ' (inactive)'}</span><OfficeToggle id={o.id} active={o.is_active} /></div>
                <OfficeForm orgId={org.orgId} office={o} /></li>))}</ul>
            <h3 className="mb-2 text-sm font-semibold">Add an office</h3><OfficeForm orgId={org.orgId} />
          </Card>
        </section>
      ))}</div>
    </>
  )
}
