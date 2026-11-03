import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { repoRoot } from '../repo-root'

/**
 * Private file storage.
 *
 *  - Keys are random (no names, phone numbers or document types in the key).
 *  - Files are never publicly readable. Access is via short-lived signed URLs
 *    issued only after the server authorizes the request (see
 *    app.authorize_file_access in the database).
 *  - "local" driver is for development only: files live outside /public and
 *    are served by an API route that verifies an HMAC signature and expiry.
 *  - "s3" driver works with any S3-compatible private bucket.
 */
export interface StoredObject {
  key: string
  size: number
  sha256: string
}

export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  remove(key: string): Promise<void>
  signedUrl(key: string, opts: { filename: string; contentType: string; expiresInSeconds: number }): Promise<string>
}

export const SIGNED_URL_TTL_SECONDS = 60
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedMime = (typeof ALLOWED_MIME)[number]

/** Detect the real file type from its first bytes (do not trust the browser). */
export function sniffMime(buf: Buffer): AllowedMime | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

export function newStorageKey(orgId: string, studentId: string): string {
  // Org/student ids are opaque UUIDs; the final segment is random.
  return `org/${orgId}/students/${studentId}/${randomUUID()}`
}

export function sha256(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex')
}

export function safeFilename(name: string): string {
  const base = path.basename(name || 'document').normalize('NFKC')
  const cleaned = base.replace(/[^\w.\- ()]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120)
  return cleaned || 'document'
}

// ---------------------------------------------------------------------------
// Local (development) driver
// ---------------------------------------------------------------------------
function signingSecret(): string {
  const s = process.env.STORAGE_SIGNING_SECRET
  if (!s || s.length < 32) throw new Error('STORAGE_SIGNING_SECRET must be set (32+ characters)')
  return s
}

function localRoot() {
  return path.resolve(/*turbopackIgnore: true*/ repoRoot(), process.env.STORAGE_LOCAL_DIR || '.data/storage')
}

function localPath(key: string) {
  if (!/^[a-zA-Z0-9/_-]+$/.test(key) || key.includes('..')) throw new Error('invalid storage key')
  const p = path.resolve(/*turbopackIgnore: true*/ localRoot(), key)
  if (!p.startsWith(localRoot() + path.sep)) throw new Error('invalid storage key')
  return p
}

export function signLocal(key: string, exp: number, filename: string, contentType: string) {
  return createHmac('sha256', signingSecret()).update(`${key}\n${exp}\n${filename}\n${contentType}`).digest('base64url')
}

export function verifyLocalSignature(key: string, exp: number, filename: string, contentType: string, sig: string) {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false
  const expected = Buffer.from(signLocal(key, exp, filename, contentType))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export async function readLocal(key: string) {
  return readFile(localPath(key))
}

const localStorage: Storage = {
  async put(key, data) {
    const p = localPath(key)
    await mkdir(path.dirname(p), { recursive: true, mode: 0o700 })
    await writeFile(p, data, { mode: 0o600, flag: 'wx' })
  },
  async get(key) {
    return readFile(localPath(key))
  },
  async remove(key) {
    await rm(localPath(key), { force: true })
  },
  async signedUrl(key, { filename, contentType, expiresInSeconds }) {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds
    const sig = signLocal(key, exp, filename, contentType)
    const q = new URLSearchParams({ k: key, e: String(exp), f: filename, t: contentType, s: sig })
    return `/api/storage/local?${q.toString()}`
  },
}

// ---------------------------------------------------------------------------
// S3-compatible driver (production / staging)
// ---------------------------------------------------------------------------
async function s3Storage(): Promise<Storage> {
  const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3')
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
  const bucket = process.env.S3_BUCKET
  if (!bucket) throw new Error('S3_BUCKET is not configured')
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || 'auto',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' },
  })
  return {
    async put(key, data, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType, IfNoneMatch: '*' }))
    },
    async get(key) {
      const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      return Buffer.from(await r.Body!.transformToByteArray())
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
    async signedUrl(key, { filename, contentType, expiresInSeconds }) {
      return getSignedUrl(client, new GetObjectCommand({
        Bucket: bucket, Key: key, ResponseContentType: contentType,
        ResponseContentDisposition: `inline; filename="${filename.replace(/"/g, '')}"`,
        ResponseCacheControl: 'no-store',
      }), { expiresIn: expiresInSeconds })
    },
  }
}

let cached: Promise<Storage> | null = null
export function getStorage(): Promise<Storage> {
  cached ??= (async () => {
    const driver = process.env.STORAGE_DRIVER || 'local'
    if (driver === 's3') return s3Storage()
    if (driver === 'local') {
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION !== 'true') {
        throw new Error('Local file storage is for development only. Configure STORAGE_DRIVER=s3.')
      }
      return localStorage
    }
    throw new Error(`Unknown STORAGE_DRIVER ${driver}`)
  })()
  return cached
}
