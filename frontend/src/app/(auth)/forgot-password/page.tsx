'use client'

import Link from 'next/link'
import { ActionForm, SubmitButton } from '@/components/forms'
import { forgotPasswordAction } from '@/app/actions/auth'

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-2 text-xl font-semibold">Forgot password</h1>
      <p className="mb-4 text-sm text-slate-600">Enter your work email. You can also ask an administrator to issue a reset link.</p>
      <ActionForm action={forgotPasswordAction} resetOnSuccess>
        <div>
          <label htmlFor="email" className="label">Work email</label>
          <input id="email" name="email" type="email" autoComplete="username" required className="input" />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Sending…">Request reset</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm"><Link href="/login">Back to sign in</Link></p>
    </>
  )
}
