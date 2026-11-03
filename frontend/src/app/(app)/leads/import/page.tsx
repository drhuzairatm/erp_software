import type { Metadata } from 'next'
import { Alert, Card, PageHeader } from '@/components/ui'
import { canAny } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { ImportForm } from '../lead-forms'
import { leadFormOptions } from '../options'

export const metadata: Metadata = { title: 'Import leads' }

export default async function ImportLeadsPage() {
  const ctx = await requireUser()
  if (!canAny(ctx, ['leads.manage', 'leads.review'])) return <PageHeader title="Import leads" description="You cannot import leads." />
  const o = await leadFormOptions(ctx)
  return (
    <>
      <PageHeader title="Import leads" back={{ href: '/leads', label: 'Leads' }} description="Bring in leads exported from Leadist (or another list) as CSV. Leadist itself is not changed." />
      <div className="mb-4"><Alert tone="blue">
        The first row must contain column names. Recognised columns: <strong>Name</strong> (or Full name / Lead name), <strong>Phone</strong> (or Mobile), WhatsApp,
        <strong> Email</strong>, Course (or Programme), Qualification, Remarks (or Notes), and <strong>Lead ID</strong> (or ID). A Lead ID that was already
        imported from the same source is skipped. Duplicates of existing leads or students are flagged for review, never merged.
      </Alert></div>
      <Card><ImportForm orgs={o.orgs} canCentral={o.canCentral} /></Card>
    </>
  )
}
