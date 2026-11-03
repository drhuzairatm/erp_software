import { createHash, randomBytes } from 'node:crypto'

/** Tokens are random 256-bit values; only their SHA-256 hash is stored. */
export function newTokenValue() {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
