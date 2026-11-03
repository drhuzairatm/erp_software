import type { Metadata } from 'next'
import { Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { canManageRequirements } from '@/services/requirements'
import { RequirementForm } from '../forms'
import { requirementOptions } from '../options'

export const metadata: Metadata = { title: 'New requirement' }

export default async function NewRequirementPage() {
  const ctx = await requireUser()
  if (!canManageRequirements(ctx)) return <PageHeader title="New requirement" description="You do not have access to this page." />
  return (
    <>
      <PageHeader title="New country-wise requirement" back={{ href: '/admin/requirements', label: 'Country-wise requirements' }} />
      <Card><RequirementForm groupId={null} {...await requirementOptions(ctx)} /></Card>
    </>
  )
}
