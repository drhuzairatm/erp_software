'use client'

import { verifyMfaAction } from '@/app/actions/auth'
import { ActionForm, SubmitButton } from '@/components/forms'

export function VerifyForm() {
  return (
    <ActionForm action={verifyMfaAction}>
      <div>
        <label htmlFor="code" className="label">Code</label>
        <input id="code" name="code" className="input text-center font-mono text-lg tracking-widest" autoComplete="one-time-code"
          inputMode="text" autoFocus required maxLength={20} placeholder="123456" />
      </div>
      <SubmitButton className="btn-primary w-full" pendingText="Checking…">Verify</SubmitButton>
    </ActionForm>
  )
}
