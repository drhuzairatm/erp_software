import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LoginForm } from './login-form'
import { getSession } from '@/server/auth/session'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string; mfa?: string; invited?: string; signedout?: string }> }) {
  if (await getSession()) redirect('/')
  const sp = await searchParams
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Sign in</h1>
      {sp.reset && <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">Your password has been set. Please sign in.</p>}
      {sp.invited && <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">Your account is active and your email address is confirmed. Please sign in.</p>}
      {sp.signedout === 'all' && <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">You have been signed out on every device.</p>}
      {sp.mfa === 'locked' && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">Sign-in cancelled after too many wrong codes or because it expired. Please sign in again.</p>}
      <LoginForm />
      <p className="mt-4 text-center text-sm"><Link href="/forgot-password">Forgot your password?</Link></p>
    </>
  )
}
