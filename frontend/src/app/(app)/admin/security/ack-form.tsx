'use client'

import { acknowledgeAlertAction } from '@/app/actions/security'
import { ActionForm, SubmitButton } from '@/components/forms'

export function AckForm({ id }: { id: string }) {
  return (
    <ActionForm action={acknowledgeAlertAction.bind(null, id)} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`ack-${id}`}>Note</label>
      <input id={`ack-${id}`} name="note" className="input py-1 text-xs" placeholder="What was checked / done (optional)" maxLength={500} />
      <SubmitButton className="btn-secondary btn-sm">Acknowledge</SubmitButton>
    </ActionForm>
  )
}
