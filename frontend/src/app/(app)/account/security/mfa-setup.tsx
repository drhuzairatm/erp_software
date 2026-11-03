'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { finishMfaAction, startMfaAction } from '@/app/actions/auth'
import { initialResult } from '@/components/action-types'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'

export function MfaSetup() {
  const [started, start, starting] = useActionState(startMfaAction, initialResult)
  const setup = started.data as { secret: string; qrDataUrl: string } | undefined
  if (!setup) {
    return (
      <form action={start} className="space-y-3 text-sm">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar).</li>
          <li>Click the button below and scan the QR code with the app.</li>
          <li>Enter the 6-digit code the app shows to finish.</li>
        </ol>
        {started.message && <p role="alert" className="text-red-700">{started.message}</p>}
        <button className="btn-primary" type="submit" disabled={starting}>{starting ? 'Preparing…' : 'Set up two-factor login'}</button>
      </form>
    )
  }
  return (
    <ActionForm action={finishMfaAction}>
      {(s) => {
        const codes = s.data?.codes as string[] | undefined
        if (codes) {
          return (
            <div className="space-y-3 text-sm">
              <p className="font-medium">Save these recovery codes now. Each works once if you lose your phone. They will not be shown again.</p>
              <ul className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-3 font-mono text-base">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
              <Link className="btn-primary" href="/">Continue to the portal</Link>
            </div>
          )
        }
        return (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={220} height={220} className="rounded border border-slate-200" />
              <p className="mt-2 text-xs text-slate-600">Can&apos;t scan? Enter this key manually:</p>
              <p className="font-mono text-sm">{setup.secret}</p>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="code" className="label">6-digit code from the app</label>
                <input id="code" name="code" className="input font-mono text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} />
                <FieldError state={s} name="code" />
              </div>
              <SubmitButton>Turn on two-factor login</SubmitButton>
            </div>
          </div>
        )
      }}
    </ActionForm>
  )
}
