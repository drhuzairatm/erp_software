'use client'

import { signOutEverywhereAction } from '@/app/actions/auth'
import { ActionForm, ConfirmSubmit } from '@/components/forms'

export function SignOutAll() {
  return (
    <ActionForm action={signOutEverywhereAction}>
      <ConfirmSubmit className="btn-secondary btn-sm" confirmText="Sign out on every device, including this one?">Sign out everywhere</ConfirmSubmit>
    </ActionForm>
  )
}
