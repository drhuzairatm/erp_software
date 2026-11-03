import { ALLOWED_MIME, readLocal, verifyLocalSignature } from '../lib/storage'

/**
 * DEVELOPMENT file server for the local storage driver (served at /api/storage/local). Rules moved verbatim, in the
 * same order, from the former Next.js route handler: disabled unless STORAGE_DRIVER is "local"; a file is served only
 * for a valid, unexpired HMAC-signed link (issued by openFile / studentPhotoDownloadUrl) with an allowed type.
 * No database access and no session: the signature is the authorization.
 */
export interface LocalLink { key: string; exp: number; filename: string; type: string; sig: string }

export type LocalFile =
  | { kind: 'disabled' }
  | { kind: 'invalid' }
  | { kind: 'missing' }
  | { kind: 'ok'; data: Buffer }

export async function localSignedFile(link: LocalLink): Promise<LocalFile> {
  if ((process.env.STORAGE_DRIVER || 'local') !== 'local') return { kind: 'disabled' }
  if (!(ALLOWED_MIME as readonly string[]).includes(link.type) || !verifyLocalSignature(link.key, link.exp, link.filename, link.type, link.sig)) {
    return { kind: 'invalid' }
  }
  try {
    return { kind: 'ok', data: await readLocal(link.key) }
  } catch {
    return { kind: 'missing' }
  }
}
