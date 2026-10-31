import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { portalSession } from '@/server/portal'
import { RequestCodeForm } from './forms'

export const metadata: Metadata = { title: 'Sign in' }

export default async function PortalSignIn({ searchParams }: { searchParams: Promise<{ expired?: string; signedout?: string }> }) {
  if (await portalSession()) redirect('/portal/home')
  const sp = await searchParams
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <div className="mb-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-700">Student portal</p>
        <h1 className="mt-1 text-2xl font-semibold">Track your application</h1>
        <p className="mt-1 text-sm text-slate-600">Dr.Expert Edulinks · GRADUATER</p>
      </div>
      <div className="card space-y-4 p-6">
        {sp.expired && <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">That code has expired or was tried too many times. Please ask for a new one.</p>}
        {sp.signedout && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">You have signed out.</p>}
        <p className="text-sm text-slate-600">We will send a one-time code to your registered email or WhatsApp number.</p>
        <RequestCodeForm />
      </div>
      <p className="mt-6 text-center text-xs text-slate-500">Staff? <a href="/login">Staff sign-in</a></p>
    </main>
  )
}
