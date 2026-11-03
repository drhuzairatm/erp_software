import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { PasswordForm } from './password-form'

export const metadata: Metadata = { title: 'Change password' }

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  await requireUser({ allowPasswordChange: true })
  const { required } = await searchParams
  return (
    <div className="max-w-md">
      <PageHeader title="Change password" description={required ? 'You must set a new password before continuing.' : 'Other sessions will be signed out.'} />
      <div className="card p-6"><PasswordForm /></div>
    </div>
  )
}
