'use client'

import { ActionForm, SubmitButton } from '@/components/forms'
import { loginAction } from '@/app/actions/auth'

export function LoginForm() {
  return (
    <ActionForm action={loginAction}>
      <div>
        <label htmlFor="email" className="label">Work email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" autoFocus />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
    </ActionForm>
  )
}
