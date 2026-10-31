'use client'

import { acknowledgeAction } from '@/app/actions/requirements'
import { ActionForm, SubmitButton } from '@/components/forms'

export function AcknowledgeButton({ studentId, noticeId }: { studentId: string; noticeId: string }) {
  return (
    <ActionForm action={acknowledgeAction.bind(null, studentId, noticeId)} className="inline">
      <SubmitButton className="btn-primary btn-sm" pendingText="Saving…">Acknowledge</SubmitButton>
    </ActionForm>
  )
}
