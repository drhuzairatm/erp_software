import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPendingMfaToken } from '@/lib/auth/session'
import { VerifyForm } from './verify-form'

export const metadata: Metadata = { title: 'Two-factor code' }

export default async function VerifyPage() {
  if (!(await getPendingMfaToken())) redirect('/login')
  return (
    <>
      <h1 className="mb-2 text-xl font-semibold">Enter your code</h1>
      <p className="mb-4 text-sm text-slate-600">Open your authenticator app and enter the 6-digit code. Lost your phone? Enter one of your recovery codes.</p>
      <VerifyForm />
      <p className="mt-4 text-center text-sm"><Link href="/login">Start again</Link></p>
    </>
  )
}
