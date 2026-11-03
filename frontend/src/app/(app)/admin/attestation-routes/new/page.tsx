import type { Metadata } from 'next'
import { Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { canManageRoutes } from '@/services/attestation'
import { routeOptions } from '../options'
import { conditionOptions } from '@/services/rules'
import { RouteForm } from '../route-forms'

export const metadata: Metadata = { title: 'New attestation route' }

export default async function NewRoutePage() {
  const ctx = await requireUser()
  if (!canManageRoutes(ctx)) return <PageHeader title="New route" description="You do not have permission to create routes." />
  return (
    <>
      <PageHeader title="New attestation route" back={{ href: '/admin/attestation-routes', label: 'Attestation routes' }} />
      <Card><RouteForm id={null} options={await routeOptions(ctx)} condOptions={await conditionOptions(ctx)} /></Card>
    </>
  )
}
