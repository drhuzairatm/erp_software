import type { Metadata } from 'next'
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { can, orgsWith } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { listCourierAddresses } from '@/services/courier'
import { AddressForm } from './forms'

export const metadata: Metadata = { title: 'Courier addresses' }

export default async function CourierAddressesPage() {
  const ctx = await requireUser()
  const orgIds = orgsWith(ctx, 'settings.manage')
  if (!can(ctx, 'settings.manage')) return <PageHeader title="Courier addresses" description="You do not have access to this page." />
  const addresses = (await listCourierAddresses(ctx)).filter((a) => orgIds.includes(a.org_id))
  const orgs = ctx.memberships.filter((m) => orgIds.includes(m.orgId)).map((m) => ({ id: m.orgId, name: m.orgName }))
  return (
    <>
      <PageHeader title="Courier addresses" description="Where students and parents send original documents. Each company enters its own address." />
      <div className="mb-4"><Alert tone="blue">
        Students see an address only after staff issue courier instructions, and staff can only do that once the scans are approved
        (scan → approval → courier). The address shown to a student is kept with the shipment, so later edits do not change past instructions.
      </Alert></div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {addresses.length === 0 ? <Card><EmptyState title="No delivery address yet">Add the office address that originals should be sent to.</EmptyState></Card>
            : addresses.map((a) => (
              <Card key={a.id} title={<span className="flex items-center gap-2">{a.label} <Badge tone={a.is_active ? 'green' : 'slate'}>{a.is_active ? 'Active' : 'Inactive'}</Badge>
                <span className="text-xs font-normal text-slate-500">{a.org_name}</span></span>}>
                <AddressForm id={a.id} orgs={orgs} value={a} />
              </Card>))}
        </div>
        <Card title="Add a delivery address"><AddressForm id={null} orgs={orgs} value={null} /></Card>
      </div>
    </>
  )
}
