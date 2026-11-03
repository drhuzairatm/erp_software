import type { Tx } from '../lib/db'

/**
 * Document-file reads (Repository Pattern, Stage 2). Each function is one query moved verbatim from the service; the
 * service keeps the business rules and the transaction (run(ctx, …)). Repositories never open transactions or set
 * app.* settings. Authorization, quarantine and audit happen inside these database functions, as before.
 */
export interface AuthorizedFile { storage_key: string; mime_type: string; original_filename: string }

/** documents.file.view (in-app viewer). No row = not allowed, unknown or quarantined (audited as denied). */
export function authorizeFileAccess(tx: Tx, fileId: string) {
  return tx<AuthorizedFile[]>`select * from app.authorize_file_access(${fileId})`
}

/** documents.download (original via a signed link). No row = not allowed, unknown or quarantined (audited). */
export function authorizeFileDownload(tx: Tx, fileId: string) {
  return tx<AuthorizedFile[]>`
    select * from app.authorize_file_download(${fileId})`
}
