import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui'
import { can } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { listKioskOffices } from '@/services/attendance'
import { KioskDisplay } from './kiosk-display'

export const metadata: Metadata = { title: 'Office QR kiosk' }

export default async function KioskPage() {
  const ctx = await requireUser()
  if (!ctx.memberships.some((m) => can(ctx, 'attendance.manage', m.orgId))) return <PageHeader title="Office QR kiosk" description="You do not have access to this page." />
  const offices = await listKioskOffices(ctx)
  return (
    <>
      <PageHeader back={{ href: '/attendance/manage', label: 'Team attendance' }} title="Office QR kiosk" description="Keep this screen open on the office tablet. Staff scan the code with their phone. It changes every 30 seconds and each person can use a code once." />
      <KioskDisplay offices={offices.map((o) => ({ id: o.id, label: `${o.name} (${o.org_name})` }))} />
    </>
  )
}
