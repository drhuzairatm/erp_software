import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { portalSession } from '@/services/portal'
import { AuthShell } from '@/components/auth-shell'
import { PasswordLoginForm, RequestCodeForm } from './forms'

export const metadata: Metadata = { title: 'Sign in' }

export default async function PortalSignIn({ searchParams }: { searchParams: Promise<{ expired?: string; signedout?: string; passwordset?: string }> }) {
  if (await portalSession()) redirect('/portal/home')
  const sp = await searchParams
  return (
    <AuthShell eyebrow="Student portal" title="Track your application, step by step." subtitle="See your admission progress, upload requested documents and know what comes next."
      footer={<>Staff? <a href="/login">Staff sign-in</a></>}>
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Track your application</h1>
        {sp.expired && <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">That code has expired or was tried too many times. Please ask for a new one.</p>}
        {sp.signedout && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">You have signed out.</p>}
        {sp.passwordset && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">Your password is saved. Sign in below.</p>}
        <PasswordLoginForm />
        <p className="text-right text-xs"><a href="/portal/forgot">Forgot password?</a></p>
        <div className="flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Sign in with a one-time code</h2>
          <p className="text-sm text-slate-600">We will send a one-time code to your registered email or WhatsApp number.</p>
          <RequestCodeForm />
        </div>
        <p className="text-xs text-slate-500">No password yet? Ask your counsellor to set up your portal account.</p>
      </div>
    </AuthShell>
  )
}
