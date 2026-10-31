import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { portalSession } from '@/server/portal'
import { AuthShell } from '@/components/auth-shell'
import { RequestCodeForm } from './forms'

export const metadata: Metadata = { title: 'Sign in' }

export default async function PortalSignIn({ searchParams }: { searchParams: Promise<{ expired?: string; signedout?: string }> }) {
  if (await portalSession()) redirect('/portal/home')
  const sp = await searchParams
  return (
    <AuthShell eyebrow="Student portal" title="Track your application, step by step." subtitle="See your admission progress, upload requested documents and know what comes next."
      footer={<>Staff? <a href="/login">Staff sign-in</a></>}>
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Track your application</h1>
        {sp.expired && <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">That code has expired or was tried too many times. Please ask for a new one.</p>}
        {sp.signedout && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">You have signed out.</p>}
        <p className="text-sm text-slate-600">We will send a one-time code to your registered email or WhatsApp number.</p>
        <RequestCodeForm />
      </div>
    </AuthShell>
  )
}
