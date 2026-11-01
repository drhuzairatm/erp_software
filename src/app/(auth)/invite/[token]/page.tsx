import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDateTime } from '@/components/format'
import { invitationInfo } from '@/server/auth/passwords'
import { InviteForm } from './invite-form'

export const metadata: Metadata = { title: 'Accept invitation', referrer: 'no-referrer' }

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const info = await invitationInfo(token)
  if (!info) {
    return (
      <>
        <h1 className="mb-2 text-xl font-semibold">Invitation not valid</h1>
        <p className="text-sm text-slate-600">This invitation is invalid, has already been used, was replaced by a newer one, or has expired. Ask your administrator to send a new invitation.</p>
        <p className="mt-4 text-sm"><Link href="/login">Go to sign in</Link></p>
      </>
    )
  }
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Welcome, {info.full_name}</h1>
      <p className="mb-4 text-sm text-slate-600">Create your private password for <strong>{info.email}</strong>. Nobody else, including administrators, can see it.
        This invitation is valid until {fmtDateTime(info.expires_at)}.</p>
      <p className="mb-4 text-sm text-slate-600">At least 12 characters, using three of: lowercase, uppercase, numbers, symbols. If your role requires two-step login, you will set it up right after signing in.</p>
      <InviteForm token={token} />
    </>
  )
}
