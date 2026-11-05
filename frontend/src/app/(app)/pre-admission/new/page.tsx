import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { dvrOrgs } from '@/services/dvr'
import { NewDvrForm } from '../forms'
import { dvrFormOptions } from '../options'

export const metadata: Metadata = { title: 'New verification request' }

export default async function NewDvrPage() {
  const ctx = await requireUser()
  if (!dvrOrgs(ctx).create.length) notFound()
  return (<>
    <PageHeader title="New verification request" description="Documents are added on the next step." back={{ href: '/pre-admission', label: 'Pre-admission' }} />
    <Card><NewDvrForm options={await dvrFormOptions(ctx)} /></Card>
  </>)
}
