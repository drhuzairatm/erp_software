import type { Metadata } from 'next'
import { Card, PageHeader } from '@/components/ui'
import { canAny } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { NewLeadForm } from '../lead-forms'
import { leadFormOptions } from '../options'

export const metadata: Metadata = { title: 'New lead' }

export default async function NewLeadPage() {
  const ctx = await requireUser()
  if (!canAny(ctx, ['leads.manage', 'leads.review'])) return <PageHeader title="New lead" description="You cannot add leads." />
  return (
    <>
      <PageHeader title="New lead" back={{ href: '/leads', label: 'Leads' }}
        description="A phone number or email is required. If the same phone or email already exists, the lead is flagged for review – nothing is merged." />
      <Card><NewLeadForm o={await leadFormOptions(ctx)} /></Card>
    </>
  )
}
