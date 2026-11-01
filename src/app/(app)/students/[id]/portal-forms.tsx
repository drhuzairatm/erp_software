'use client'

import { useState } from 'react'
import { issuePortalLinkAction, portalAccountStatusAction, publishAction, unpublishAction } from '@/app/actions/portal-accounts'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'

export function IssueLinkButton({ studentId, label }: { studentId: string; label: string }) {
  return (
    <ActionForm action={issuePortalLinkAction.bind(null, studentId)} className="space-y-2">
      {(s) => (
        <>
          {typeof s.data?.link === 'string' && (
            <div className="space-y-1">
              <label className="label text-xs" htmlFor={`link-${studentId}`}>One-time link (shown only now)</label>
              <input id={`link-${studentId}`} readOnly className="input font-mono text-xs" value={s.data.link} onFocus={(e) => e.currentTarget.select()} />
            </div>
          )}
          <SubmitButton className="btn-primary btn-sm">{label}</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}

export function AccountStatusForm({ studentId, enabled }: { studentId: string; enabled: boolean }) {
  const [open, setOpen] = useState(false)
  if (!enabled) return <ActionForm action={portalAccountStatusAction.bind(null, studentId, true)}><SubmitButton className="btn-secondary btn-sm">Enable account</SubmitButton></ActionForm>
  if (!open) return <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>Disable account…</button>
  return (
    <ActionForm action={portalAccountStatusAction.bind(null, studentId, false)} className="space-y-2">
      {(s) => (
        <>
          <div><label className="label text-xs" htmlFor={`dis-${studentId}`}>Reason *</label>
            <input className="input py-1.5" id={`dis-${studentId}`} name="reason" required maxLength={300} /><FieldError state={s} name="reason" /></div>
          <SubmitButton className="btn-danger btn-sm">Disable account</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}

export function PublishForm({ studentId, documentId, defaultTitle }: { studentId: string; documentId: string; defaultTitle: string }) {
  return (
    <ActionForm action={publishAction.bind(null, studentId, documentId)} className="flex flex-wrap items-end gap-2">
      <div><label className="label text-xs" htmlFor={`pt-${documentId}`}>Title shown to the student</label>
        <input className="input py-1.5 text-sm" id={`pt-${documentId}`} name="title" defaultValue={defaultTitle} maxLength={200} /></div>
      <SubmitButton className="btn-secondary btn-sm">Publish to portal</SubmitButton>
    </ActionForm>
  )
}

export function UnpublishForm({ studentId, publicationId }: { studentId: string; publicationId: string }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>Withdraw…</button>
  return (
    <ActionForm action={unpublishAction.bind(null, studentId, publicationId)} className="flex flex-wrap items-end gap-2">
      {(s) => (
        <>
          <div><label className="label text-xs" htmlFor={`ur-${publicationId}`}>Reason *</label>
            <input className="input py-1.5 text-sm" id={`ur-${publicationId}`} name="reason" required maxLength={300} /><FieldError state={s} name="reason" /></div>
          <SubmitButton className="btn-danger btn-sm">Withdraw</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}
