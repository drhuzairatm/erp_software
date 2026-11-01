import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Time-based one-time passwords (RFC 6238 / RFC 4226): HMAC-SHA1, 6 digits,
 * 30-second steps — compatible with Google Authenticator, Microsoft
 * Authenticator, 1Password, etc.
 */
const STEP_SECONDS = 30
const DIGITS = 6
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error('invalid base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', secret).update(msg).digest()
  const offset = h[h.length - 1] & 0xf
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3]
  return String(code % 10 ** digits).padStart(digits, '0')
}

export function currentStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP_SECONDS)
}

export function totp(secretBase32: string, step = currentStep()): string {
  return hotp(base32Decode(secretBase32), step)
}

/**
 * Verify a code, allowing one step of clock drift either side. Returns the
 * matched step (to be stored so the same code can never be used twice), or null.
 */
export function verifyTotp(secretBase32: string, code: string, lastUsedStep: number, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const key = base32Decode(secretBase32)
  const now = currentStep(nowMs)
  for (const step of [now - 1, now, now + 1]) {
    if (step <= lastUsedStep) continue
    const expected = Buffer.from(hotp(key, step))
    if (timingSafeEqual(expected, Buffer.from(code))) return step
  }
  return null
}

export function otpauthUri(secretBase32: string, account: string, issuer = 'Edulinks-GRADUATER Staff') {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const q = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) })
  return `otpauth://totp/${label}?${q.toString()}`
}

// ---------------------------------------------------------------------------
// Secret encryption (AES-256-GCM). The key lives in the environment, never in
// the database, so a database leak alone does not reveal 2FA secrets.
// ---------------------------------------------------------------------------
function key(): Buffer {
  const k = Buffer.from(process.env.MFA_ENCRYPTION_KEY ?? '', 'base64')
  if (k.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be 32 random bytes, base64-encoded')
  return k
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, ct] = blob.split(':')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('unknown secret format')
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

// ---------------------------------------------------------------------------
// Recovery codes: 10 single-use codes, shown once, stored hashed.
// ---------------------------------------------------------------------------
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const raw = base32Encode(randomBytes(6)).slice(0, 8)
    return `${raw.slice(0, 4)}-${raw.slice(4)}`
  })
}

export function normaliseRecoveryCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '')
}

export function hashRecoveryCode(code: string) {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex')
}

/**
 * Is two-factor login required? MD decision (1 Nov 2026): YES for every staff user.
 * Production builds always require it – no setting, flag or role can switch it off.
 * Only local development/automated-test environments may relax it with MFA_ENFORCE=roles|off.
 */
export function mfaRequired(roleFlags: boolean[]): boolean {
  if (process.env.NODE_ENV === 'production') return true
  const mode = process.env.MFA_ENFORCE ?? 'all'
  if (mode === 'off') return false
  if (mode === 'roles') return roleFlags.some(Boolean)
  return true
}
