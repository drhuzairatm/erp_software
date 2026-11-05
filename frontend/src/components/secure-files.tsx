import { fmtDateTime } from './format'
import { ClearSecureFileForm, RemoveSecureFileButton, SecureFileUploadForm } from './secure-file-forms'
import { ScanBadge } from './scan-badge'
import { Card } from './ui'
import { type Ctx } from '@/services/base'
import { canAttachSecureFile, listSecureFiles, type SecureContext } from '@/services/secure-files'

/** Files attached to a record, with their scan state. Used by tasks, employee documents and other modules. */
export async function SecureFilesCard({ ctx, title, contextType, contextId, path, readOnly }: { ctx: Ctx; title: string; contextType: SecureContext; contextId: string; path: string; readOnly?: boolean }) {
  const [files, canAttach] = await Promise.all([listSecureFiles(ctx, contextType, contextId), canAttachSecureFile(ctx, contextType, contextId)])
  return (
    <Card title={title}>
      {files.length === 0 ? <p className="hint mb-3">No files yet.</p> : (
        <ul className="mb-3 divide-y divide-slate-100 text-sm">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <a href={`/api/secure-files/${f.id}`} target="_blank" rel="noopener" className="wrap-anywhere">{f.original_filename}</a>
                <span className="block text-xs text-slate-500">{f.uploader_name ?? 'Unknown'} · {fmtDateTime(f.uploaded_at)} · {Math.max(1, Math.round(f.size_bytes / 1024))} KB</span>
              </span>
              <span className="flex flex-wrap items-center gap-2"><ScanBadge status={f.scan_status} />
                {f.can_clear && !readOnly && <ClearSecureFileForm fileId={f.id} path={path} />}
                {f.can_remove && !readOnly && <RemoveSecureFileButton fileId={f.id} path={path} />}</span>
            </li>
          ))}
        </ul>
      )}
      {canAttach && !readOnly && <SecureFileUploadForm contextType={contextType} contextId={contextId} path={path} />}
      <p className="hint mt-2">PDF, JPEG, PNG or WebP, up to 10 MB. Files are private: each opening is checked and recorded.</p>
    </Card>
  )
}
