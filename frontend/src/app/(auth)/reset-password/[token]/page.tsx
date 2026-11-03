import type { Metadata } from 'next'
import Link from 'next/link'
import { resetTokenValid } from '@/lib/auth/passwords'
import { ResetForm } from './reset-form'

export const metadata: Metadata = { title: 'Set password', referrer: 'no-referrer' }

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const valid = await resetTokenValid(token)
  if (!valid) {
    return (
      <>
        <h1 className="mb-2 text-xl font-semibold">Link expired</h1>
        <p className="text-sm text-slate-600">This password link is invalid, has already been used, or has expired. Ask your administrator for a new one.</p>
        <p className="mt-4 text-sm"><Link href="/login">Back to sign in</Link></p>
      </>
    )
  }
  return (
    <>
      <h1 className="mb-2 text-xl font-semibold">Set your password</h1>
      <p className="mb-4 text-sm text-slate-600">At least 12 characters, using three of: lowercase, uppercase, numbers, symbols.</p>
      <ResetForm token={token} />
    </>
  )
}
