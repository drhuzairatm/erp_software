'use client'

import { clearSecureFileAction, removeSecureFileAction, uploadSecureFileAction } from '@/app/actions/secure-files'
import type { SecureContext } from '@/services/secure-files'
import { ActionForm, ConfirmSubmit, SubmitButton } from './forms'

export function SecureFileUploadForm({ contextType, contextId, path }: { contextType: SecureContext; contextId: string; path: string }) {
  const id = `${contextType}-file`
  return (
    <ActionForm action={uploadSecureFileAction.bind(null, contextType, contextId, path)} className="flex flex-wrap items-center gap-2" resetOnSuccess>
      <label className="label mb-0" htmlFor={id}>Add a file</label>
      <input id={id} type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/webp"
        className="block max-w-64 text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs" />
      <SubmitButton className="btn-secondary btn-sm" pendingText="Uploading…">Upload</SubmitButton>
    </ActionForm>
  )
}

export function RemoveSecureFileButton({ fileId, path }: { fileId: string; path: string }) {
  return (
    <ActionForm action={removeSecureFileAction.bind(null, fileId, path)} className="inline">
      <ConfirmSubmit className="btn-secondary btn-sm" confirmText="Remove this file?" pendingText="Removing…">Remove</ConfirmSubmit>
    </ActionForm>
  )
}

export function ClearSecureFileForm({ fileId, path }: { fileId: string; path: string }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-brand-700">Clear manually</summary>
      <ActionForm action={clearSecureFileAction.bind(null, fileId, path)} className="mt-1 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`clr-${fileId}`}>Reason for clearing</label>
        <input id={`clr-${fileId}`} name="reason" className="input" placeholder="Reason for clearing" required minLength={5} maxLength={500} />
        <SubmitButton className="btn-secondary btn-sm">Confirm clearance</SubmitButton>
      </ActionForm>
    </details>
  )
}
