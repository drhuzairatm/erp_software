import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { confirmEmailVerification } from '@/server/services/passport'

export const metadata: Metadata = { title: 'Confirm your email address', robots: { index: false } }

const RESULT = {
  verified: { tone: 'bg-green-50 text-green-900', text: 'Thank you. Your email address is now verified.' },
  expired: { tone: 'bg-amber-50 text-amber-900', text: 'This link has expired. Please ask your counsellor to send a new one.' },
  invalid: { tone: 'bg-amber-50 text-amber-900', text: 'This link is not valid any more (it may already have been used, or the email address was changed).' },
} as const

async function confirm(fd: FormData) {
  'use server'
  const r = await confirmEmailVerification(String(fd.get('token') ?? ''))
  redirect(`/verify-email?result=${r}`)
}

/** Opened from the verification email. Confirmation needs a click, so link scanners cannot verify an address. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; result?: string }> }) {
  const sp = await searchParams
  const result = RESULT[sp.result as keyof typeof RESULT]
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <div className="mb-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-700">Email verification</p>
        <p className="mt-1 text-sm text-slate-600">Dr.Expert Edulinks · GRADUATER</p>
      </div>
      <div className="card space-y-4 p-6">
        {result ? <p role="status" className={`rounded-md px-3 py-2 text-sm ${result.tone}`}>{result.text}</p>
          : sp.token ? (
            <form action={confirm} className="space-y-3">
              <input type="hidden" name="token" value={sp.token} />
              <p className="text-sm text-slate-700">Press the button to confirm that this email address belongs to you.</p>
              <button type="submit" className="btn-primary w-full">Confirm my email address</button>
            </form>
          ) : <p className="text-sm text-slate-600">Open the link from the verification email.</p>}
      </div>
    </main>
  )
}
