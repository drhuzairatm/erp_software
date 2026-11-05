import { invalid } from '../lib/errors'
import { getStorage, MAX_UPLOAD_BYTES, newSecureStorageKey, safeFilename, sha256, SIGNED_URL_TTL_SECONDS, sniffMime } from '../lib/storage'
import { anonymous } from '../lib/db'
import { refuseIfInfected } from '../lib/security/file-scan'
import { scannerName } from '../lib/security/scanner'
import { audit, type Ctx, run } from './base'

/**
 * Secure files that have no student document (first use: task attachments). The rules live in the database functions; this
 * service reuses the existing storage, scanner, signed links and audit. An infected upload is refused and never stored.
 */
export type SecureContext = 'task' | 'employee' | 'attendance' | 'meeting' | 'chat' | 'dvr' | 'ticket'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SecureFileRow {
  id: string; original_filename: string; mime_type: string; size_bytes: number; scan_status: string
  uploaded_by: string; uploaded_at: Date; uploader_name: string | null; can_remove: boolean; can_clear: boolean
}

export async function uploadSecureFile(ctx: Ctx, contextType: SecureContext, contextId: string, file: File) {
  if (!UUID_RE.test(contextId)) throw invalid('Not found.')
  if (!(file instanceof File) || file.size === 0) throw invalid('Choose a file to upload.')
  if (file.size > MAX_UPLOAD_BYTES) throw invalid('The file is larger than 10 MB.')
  const buf = Buffer.from(await file.arrayBuffer())
  const mime = sniffMime(buf)
  if (!mime) throw invalid('Only PDF, JPEG, PNG or WebP files are accepted.')
  const orgId = await run(ctx, async (tx) => {
    const [r] = await tx<{ org: string }[]>`select app.secure_file_upload_org(${contextType}, ${contextId}) as org`
    return r.org
  })
  const scan = await refuseIfInfected(ctx, buf, `${contextType}:${contextId}`)
  const storage = await getStorage()
  const key = newSecureStorageKey(orgId, contextType, contextId)
  await storage.put(key, buf, mime)
  let fileId: string
  try {
    const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.register_secure_file(${contextType}, ${contextId}, ${key}, ${safeFilename(file.name)}, ${mime}, ${buf.length}, ${sha256(buf)}) as id`)
    fileId = r.id
  } catch (e) {
    await storage.remove(key).catch(() => {})
    throw e
  }
  if (scan) await anonymous((tx) => tx`select app.record_secure_file_scan(${key}, ${scan.status}, ${scan.engine}, ${scan.detail ?? null})`)
  return fileId
}

export async function listSecureFiles(ctx: Ctx, contextType: SecureContext, contextId: string) {
  if (!UUID_RE.test(contextId)) return []
  return run(ctx, (tx) => tx<SecureFileRow[]>`
    select f.id, f.original_filename, f.mime_type, f.size_bytes::int as size_bytes, f.scan_status, f.uploaded_by, f.uploaded_at, u.full_name as uploader_name,
           ((f.uploaded_by = ${ctx.userId} and app.secure_file_can_write(f.context_type, f.context_id))
            or (f.context_type = 'task' and app.has_perm(f.org_id, 'tasks.update.all'))
            or (f.context_type = 'employee' and app.has_perm(f.org_id, 'users.manage'))) as can_remove,
           (f.scan_status in ('not_scanned', 'scan_failed') and f.uploaded_by <> ${ctx.userId} and app.has_perm(f.org_id, 'documents.security_clear')) as can_clear
      from secure_files f left join user_profiles u on u.id = f.uploaded_by
     where f.context_type = ${contextType} and f.context_id = ${contextId}
     order by f.uploaded_at, f.id`)
}

export async function canAttachSecureFile(ctx: Ctx, contextType: SecureContext, contextId: string) {
  if (!UUID_RE.test(contextId)) return false
  const [r] = await run(ctx, (tx) => tx<{ ok: boolean }[]>`select app.secure_file_can_write(${contextType}, ${contextId}) as ok`)
  return r.ok
}

/** A 60-second signed link, after the audited permission check. Null if not allowed, unknown, removed or quarantined. */
export async function openSecureFile(ctx: Ctx, fileId: string): Promise<string | null> {
  if (!UUID_RE.test(fileId)) return null
  // With a scanner configured, a file it has not passed is held in quarantine until it is scanned or an authorised person clears it.
  if (scannerName()) {
    const held = await run(ctx, async (tx) => {
      const [h] = await tx<{ org_id: string; scan_status: string }[]>`select org_id, scan_status from secure_files where id = ${fileId} and scan_status in ('not_scanned', 'scan_failed')`
      if (h) await audit(tx, 'file_download', 'secure_files', fileId, { orgId: h.org_id, outcome: 'denied', metadata: { reason: 'awaiting_scan', scan_status: h.scan_status } })
      return !!h
    })
    if (held) return null
  }
  const [f] = await run(ctx, (tx) => tx<{ storage_key: string; mime_type: string; original_filename: string }[]>`
    select * from app.authorize_secure_file_download(${fileId})`)
  if (!f) return null
  return (await getStorage()).signedUrl(f.storage_key, { filename: f.original_filename, contentType: f.mime_type, expiresInSeconds: SIGNED_URL_TTL_SECONDS })
}

export async function removeSecureFile(ctx: Ctx, fileId: string) {
  if (!UUID_RE.test(fileId)) throw invalid('Not found.')
  await run(ctx, (tx) => tx`select app.remove_secure_file(${fileId})`)
}

/** Manual clearance by someone other than the uploader who holds the sensitive permission. Audited; never possible for an infected file. */
export async function clearSecureFile(ctx: Ctx, fileId: string, reason: string) {
  if (!UUID_RE.test(fileId)) throw invalid('Not found.')
  await run(ctx, (tx) => tx`select app.clear_secure_file_manually(${fileId}, ${reason})`)
}

export interface SecureFileEvent { occurred_at: Date; action: string; outcome: string; file_id: string; actor: string | null }
export async function secureFileHistory(ctx: Ctx, contextType: SecureContext, contextId: string) {
  if (!UUID_RE.test(contextId)) return []
  return run(ctx, (tx) => tx<SecureFileEvent[]>`select * from app.secure_file_upload_download_history(${contextType}, ${contextId})`)
}
