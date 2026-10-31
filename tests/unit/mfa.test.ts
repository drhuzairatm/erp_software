import { afterEach, describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, decryptSecret, encryptSecret, hashRecoveryCode, hotp, mfaRequired, totp, verifyTotp } from '@/server/auth/mfa'

const RFC_SECRET = Buffer.from('12345678901234567890') // RFC 4226 / 6238 test secret

describe('one-time codes follow the RFCs', () => {
  it('HOTP matches RFC 4226 test vectors', () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(RFC_SECRET, c))).toEqual(['755224', '287082', '359152', '969429', '520489'])
  })
  it('TOTP matches RFC 6238 (SHA-1) vectors, 6-digit form', () => {
    const b32 = base32Encode(RFC_SECRET)
    expect(totp(b32, Math.floor(59 / 30))).toBe('287082')
    expect(totp(b32, Math.floor(1111111109 / 30))).toBe('081804')
    expect(totp(b32, Math.floor(1234567890 / 30))).toBe('005924')
  })
  it('base32 round-trips', () => {
    expect(base32Decode(base32Encode(RFC_SECRET)).equals(RFC_SECRET)).toBe(true)
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI')
  })
  it('accepts ±1 step of clock drift, rejects reuse and older codes', () => {
    const b32 = base32Encode(RFC_SECRET)
    const now = 1_700_000_000_000
    const step = Math.floor(now / 30000)
    expect(verifyTotp(b32, totp(b32, step), 0, now)).toBe(step)
    expect(verifyTotp(b32, totp(b32, step - 1), 0, now)).toBe(step - 1)
    expect(verifyTotp(b32, totp(b32, step - 2), 0, now)).toBeNull()
    expect(verifyTotp(b32, totp(b32, step), step, now)).toBeNull() // already used
    expect(verifyTotp(b32, 'abcdef', 0, now)).toBeNull()
  })
})

describe('secret encryption', () => {
  it('round-trips and detects tampering', () => {
    const blob = encryptSecret('JBSWY3DPEHPK3PXP')
    expect(blob).not.toContain('JBSWY3DPEHPK3PXP')
    expect(decryptSecret(blob)).toBe('JBSWY3DPEHPK3PXP')
    const parts = blob.split(':')
    parts[3] = Buffer.from('tampered!!').toString('base64')
    expect(() => decryptSecret(parts.join(':'))).toThrow()
  })
  it('recovery codes are compared ignoring case and dashes', () => {
    expect(hashRecoveryCode('abcd-ef23')).toBe(hashRecoveryCode('ABCDEF23'))
  })
})

describe('enforcement setting', () => {
  const orig = { ...process.env }
  afterEach(() => { process.env = { ...orig } })
  it('roles / all / off', () => {
    process.env.MFA_ENFORCE = 'roles'
    expect(mfaRequired([false, true])).toBe(true)
    expect(mfaRequired([false])).toBe(false)
    process.env.MFA_ENFORCE = 'all'
    expect(mfaRequired([false])).toBe(true)
    process.env.MFA_ENFORCE = 'off'
    expect(mfaRequired([true])).toBe(false)
  })
  it('"off" is ignored in production builds', () => {
    process.env.MFA_ENFORCE = 'off'
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    expect(mfaRequired([true])).toBe(true)
  })
})
