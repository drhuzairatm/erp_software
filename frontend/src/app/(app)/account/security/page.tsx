import type { Metadata } from 'next'
import { fmtDateTime } from '@/components/format'
import { Alert, Card, PageHeader } from '@/components/ui'
import { mfaStatus } from '@/lib/auth/mfa-service'
import { requireUser } from '@/lib/auth/session'
import { MfaSetup } from './mfa-setup'
import { LoginActivity } from '@/components/login-activity'
import { loginActivity } from '@/services/security'
import { SignOutAll } from './sign-out-all'

export const metadata: Metadata = { title: 'Two-factor login' }

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const ctx = await requireUser({ allowMfaSetup: true })
  const { required } = await searchParams
  const status = await mfaStatus(ctx)
  const activity = await loginActivity(ctx, ctx.userId, 30)
  return (
    <div className="max-w-2xl">
      <PageHeader title="Two-factor login" description="A code from an authenticator app on your phone is needed every time you sign in, in addition to your password." />
      {required && !status.enabled && <div className="mb-4"><Alert tone="amber" title="Required for your role">Set up two-factor login to continue using the portal.</Alert></div>}
      <Card>
        {status.enabled ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium text-green-800">Two-factor login is on (since {fmtDateTime(status.enabled_at)}).</p>
            <p>Unused recovery codes: <strong>{status.recovery_codes_left}</strong>{status.recovery_codes_left <= 3 && ' — running low; ask an administrator to reset your two-factor login to get new codes.'}</p>
            <p className="text-slate-600">New phone or lost access? Sign in with one of your recovery codes. If you have none left, ask the MD (or a person they have authorised) to reset your two-factor login after verifying your identity; you then set it up again at your next sign-in.</p>
          </div>
        ) : <MfaSetup />}
      </Card>
      <Card title="Signed in somewhere else?" className="mt-6">
        <p className="mb-3 text-sm text-slate-600">If you used a shared or lost device, sign out everywhere. This ends every session, including this one.</p>
        <SignOutAll />
      </Card>
      {activity && <div className="mt-6"><LoginActivity data={activity} /></div>}
    </div>
  )
}
