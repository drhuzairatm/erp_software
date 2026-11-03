import 'server-only'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Encryption of sign-in codes and email-verification links in the secure authentication queue (finding N-8).
 *
 * - AES-256-GCM (authenticated). The key is DERIVED with HKDF-SHA256 from MFA_ENCRYPTION_KEY (environment only, never in
 *   the database) with the label "erp-auth-message-v1", so it is cryptographically separate from the key used for
 *   two-step secrets and the N-1 / N-7 queues (whose implementation is unchanged).
 * - The message kind is bound as associated data: a cipher text made for one kind cannot be decrypted as another.
 * - Format "am1:<iv 12 bytes>:<tag 16 bytes>:<cipher text>" (base64). Anything malformed, truncated, tampered with or made
 *   with another key is REJECTED by decryptAuthSecret (the database CHECK only checks the shape, never the encryption).
 * - Never log the key, the plain text or the cipher text.
 *
 * Key rotation: changing MFA_ENCRYPTION_KEY makes every pending N-1, N-7 and N-8 message undeliverable (they are marked
 * failed and wiped; people request a new code / link) AND requires every staff member to re-enrol two-step login.
 */
export type AuthSecretKind = 'portal_login_code' | 'email_verification'
const INFO = 'erp-auth-message-v1'
const B64 = /^[A-Za-z0-9+/]+={0,2}$/

function key(): Buffer {
  const ikm = Buffer.from(process.env.MFA_ENCRYPTION_KEY ?? '', 'base64')
  if (ikm.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be 32 random bytes, base64-encoded')
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), INFO, 32))
}

export function encryptAuthSecret(kind: AuthSecretKind, plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  c.setAAD(Buffer.from(kind, 'utf8'))
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['am1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

/** Authenticated decryption; throws on any malformed, unauthenticated or wrong-kind cipher text. */
export function decryptAuthSecret(kind: AuthSecretKind, blob: string): string {
  const parts = typeof blob === 'string' ? blob.split(':') : []
  if (parts.length !== 4 || parts[0] !== 'am1' || !parts.slice(1).every((p) => B64.test(p))) throw new Error('malformed secret')
  const iv = Buffer.from(parts[1], 'base64'); const tag = Buffer.from(parts[2], 'base64'); const ct = Buffer.from(parts[3], 'base64')
  if (iv.length !== 12 || tag.length !== 16 || ct.length === 0) throw new Error('malformed secret')
  const d = createDecipheriv('aes-256-gcm', key(), iv, { authTagLength: 16 })
  d.setAAD(Buffer.from(kind, 'utf8'))
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
}
