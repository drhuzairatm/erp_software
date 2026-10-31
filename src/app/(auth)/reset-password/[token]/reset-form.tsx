'use client'

import { ActionForm, FieldError, SubmitButton } from '@/components/forms'
import { resetPasswordAction } from '@/app/actions/auth'

export function ResetForm({ token }: { token: string }) {
  return (
    <ActionForm action={resetPasswordAction}>
      {(state) => (
        <>
          <input type="hidden" name="token" value={token} />
          <div>
            <label htmlFor="password" className="label">New password</label>
            <input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} className="input" aria-invalid={!!state.fieldErrors?.password} />
            <FieldError state={state} name="password" />
          </div>
          <div>
            <label htmlFor="confirm" className="label">Confirm password</label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="input" aria-invalid={!!state.fieldErrors?.confirm} />
            <FieldError state={state} name="confirm" />
          </div>
          <SubmitButton className="btn-primary w-full">Set password</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}
