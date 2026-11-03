'use client'

import { clearFileAction } from '@/app/actions/security'
import { ActionForm, ConfirmSubmit, FieldError } from '@/components/forms'
import { fmtDateTime } from '@/components/format'
import { ScanBadge } from '@/components/scan-badge'

type F = { id: string; version: number; uploaded_by: string | null; scan_status: string; scan_engine: string | null; scan_detail: string | null
  scanned_at: Date | null; cleared_at: Date | null; cleared_by_name: string | null; clearance_reason: string | null }

/** Virus-scan status of the file shown; MANUAL security clearance for files that could not be scanned. */
export function ScanPanel({ file, canClear, me }: { file: F; canClear: boolean; me: string }) {
  const needs = file.scan_status === 'not_scanned' || file.scan_status === 'scan_failed'
  return (
    <section aria-label="Virus scan" className={`mb-3 rounded-xl border p-3 text-sm ${file.scan_status === 'infected' ? 'border-red-300 bg-red-50' : needs ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">File v{file.version} security:</span> <ScanBadge status={file.scan_status} />
        {file.scanned_at && <span className="text-xs text-slate-600">{file.scan_engine} · {fmtDateTime(file.scanned_at)}{file.scan_detail ? ` · ${file.scan_detail}` : ''}</span>}
        {file.scan_status === 'manually_cleared' && <span className="text-xs text-slate-700">Cleared manually by {file.cleared_by_name} on {fmtDateTime(file.cleared_at)}: “{file.clearance_reason}”. This is not an automated virus scan.</span>}
      </div>
      {needs && <p className="mt-1 text-xs text-amber-900">This file has not been checked by a virus scanner{file.scan_status === 'scan_failed' ? ' (the scan failed)' : ''}. It cannot be approved or released for courier until it is scanned, or an authorised person gives manual security clearance.</p>}
      {needs && canClear && file.uploaded_by !== me && (
        <ActionForm action={clearFileAction.bind(null, file.id)} className="mt-2 flex flex-wrap items-end gap-2">
          {(s) => (<>
            <div className="min-w-72 flex-1"><label className="label" htmlFor="clear-reason">Manual clearance reason *</label>
              <input id="clear-reason" name="reason" className="input" minLength={10} maxLength={500} required placeholder="e.g. Original seen in person; file opened in an isolated viewer" />
              <FieldError state={s} name="reason" /></div>
            <ConfirmSubmit className="btn-secondary btn-sm" confirmText="Record a MANUAL security clearance (not a virus scan)?">Give manual clearance</ConfirmSubmit>
          </>)}
        </ActionForm>
      )}
      {needs && canClear && file.uploaded_by === me && <p className="mt-1 text-xs text-slate-600">You uploaded this file, so another authorised person must give manual clearance.</p>}
    </section>
  )
}
