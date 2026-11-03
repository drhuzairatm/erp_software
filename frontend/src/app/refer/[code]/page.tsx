import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth-shell'
import { publicReferralInfo, referralCountries } from '@/server/portal'
import { ReferralForm } from '@/app/portal/referral-forms'

export const metadata: Metadata = { title: 'Study abroad – referral', robots: { index: false } }

export default async function ReferralLanding({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const info = await publicReferralInfo(code)
  const countries = info ? await referralCountries() : []
  return (
    <AuthShell eyebrow="Refer a friend" title="Study medicine and more, abroad." subtitle="Leave your details and an admissions counsellor will contact you.">
      {!info ? <p role="alert" className="text-sm text-slate-700">This referral link is not valid.</p> : (
        <div className="space-y-4">
          <h1 className="text-xl font-bold">{info.first_name} thinks you might be interested</h1>
          <p className="text-sm text-slate-600">Your details go to {info.company}&apos;s admissions team. They are not shared with {info.first_name}.</p>
          <ReferralForm mode="link" code={code} countries={countries.map((c) => ({ id: c.id, name: c.name }))}
            destinations={countries.filter((c) => c.is_destination).map((c) => ({ id: c.id, name: c.name }))} />
        </div>
      )}
    </AuthShell>
  )
}
