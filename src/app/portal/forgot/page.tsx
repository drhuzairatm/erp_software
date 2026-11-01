import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth-shell'
import { ForgotPasswordForm } from '../forms'

export const metadata: Metadata = { title: 'Forgot password' }

export default function ForgotPasswordPage() {
  return (
    <AuthShell eyebrow="Student portal" title="Locked out? It happens." subtitle="We email a reset link to your verified email address."
      footer={<a href="/portal">Back to sign-in</a>}>
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Forgot password</h1>
        <p className="text-sm text-slate-600">Enter your Student ID or verified email. If your email is not verified yet, ask your counsellor for a new set-up link.</p>
        <ForgotPasswordForm />
      </div>
    </AuthShell>
  )
}
