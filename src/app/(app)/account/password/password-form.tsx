'use client'

import { ActionForm, FieldError, SubmitButton } from '@/components/forms'
import { changePasswordAction } from '@/app/actions/auth'

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction}>
      {(s) => (
        <>
          {(['current', 'next', 'confirm'] as const).map((n) => (
            <div key={n}>
              <label htmlFor={n} className="label">{n === 'current' ? 'Current password' : n === 'next' ? 'New password' : 'Confirm new password'}</label>
              <input id={n} name={n} type="password" required className="input" autoComplete={n === 'current' ? 'current-password' : 'new-password'} aria-invalid={!!s.fieldErrors?.[n]} />
              <FieldError state={s} name={n} />
            </div>
          ))}
          <p className="hint">At least 12 characters, using three of: lowercase, uppercase, numbers, symbols.</p>
          <SubmitButton>Change password</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}
