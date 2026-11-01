import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth-shell'
import { checkPasswordLink } from '@/server/portal'
import { SetPasswordForm } from '../forms'

export const metadata: Metadata = { title: 'Set your password' }

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams
  const code = await checkPasswordLink(token)
  return (
    <AuthShell eyebrow="Student portal" title="Your application, always with you." subtitle="Choose a password to sign in to the student portal."
      footer={<a href="/portal">Back to sign-in</a>}>
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Set your password</h1>
        {code ? (
          <>
            <p className="text-sm text-slate-600">Student ID <span className="font-mono font-semibold text-slate-900">{code}</span>. You can sign in with this ID or your verified email address.</p>
            <SetPasswordForm token={token} />
          </>
        ) : (
          <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">This link has expired or was already used. Use “Forgot password” on the sign-in page, or ask your counsellor for a new link.</p>
        )}
      </div>
    </AuthShell>
  )
}
