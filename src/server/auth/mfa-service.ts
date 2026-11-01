import QRCode from 'qrcode'
import { anonymous, withUser } from '../db'
import { invalid } from '../errors'
import type { Ctx } from '../services/base'
import { run } from '../services/base'
import { decryptSecret, encryptSecret, hashRecoveryCode, newRecoveryCodes, newTotpSecret, normaliseRecoveryCode, otpauthUri, verifyTotp } from './mfa'

const SESSION_TTL_HOURS = 12

export type MfaLoginResult = { ok: true } | { ok: false; message: string; locked?: boolean }

/** Second sign-in step: a 6-digit authenticator code, or a recovery code. */
export async function verifyLoginCode(tokenHash: string, rawCode: string): Promise<MfaLoginResult> {
  const code = rawCode.replace(/\s/g, '')
  return anonymous(async (tx) => {
    let ok = false
    if (/^\d{6}$/.test(code)) {
      const [c] = await tx<{ user_id: string; secret_encrypted: string; last_used_step: string }[]>`select * from app.auth_mfa_challenge(${tokenHash})`
      if (!c) return { ok: false as const, message: 'This sign-in has expired. Please sign in again.', locked: true }
      const step = verifyTotp(decryptSecret(c.secret_encrypted), code, Number(c.last_used_step))
      if (step !== null) {
        const [r] = await tx<{ ok: boolean }[]>`select app.auth_mfa_complete(${tokenHash}, ${step}, ${SESSION_TTL_HOURS}) as ok`
        ok = r.ok
      }
    } else if (normaliseRecoveryCode(code).length === 8) {
      const [r] = await tx<{ ok: boolean }[]>`select app.auth_mfa_use_recovery(${tokenHash}, ${hashRecoveryCode(code)}, ${SESSION_TTL_HOURS}) as ok`
      ok = r.ok
    }
    if (ok) return { ok: true as const }
    const [{ failures }] = await tx<{ failures: number }[]>`select app.auth_mfa_failed(${tokenHash}) as failures`
    if (failures >= 5) return { ok: false as const, message: 'Too many wrong codes. Please sign in again.', locked: true }
    return { ok: false as const, message: `That code is not correct. ${5 - failures} attempt${5 - failures === 1 ? '' : 's'} left.` }
  })
}

export async function mfaStatus(ctx: Ctx) {
  const [s] = await run(ctx, (tx) => tx<{ enabled: boolean; enabled_at: Date | null; recovery_codes_left: number }[]>`select * from app.mfa_my_status()`)
  return s
}

/** Begin setup: new secret (stored encrypted, not active yet) + QR code to scan. */
export async function startEnrolment(ctx: Ctx, email: string) {
  const secret = newTotpSecret()
  await run(ctx, (tx) => tx`select app.mfa_start_enrolment(${encryptSecret(secret)})`)
  const uri = otpauthUri(secret, email)
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, width: 220, errorCorrectionLevel: 'M' })
  return { secret: secret.match(/.{1,4}/g)!.join(' '), qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` }
}

/** Confirm setup with a code from the app; returns one-time recovery codes. */
export async function finishEnrolment(ctx: Ctx, code: string): Promise<string[]> {
  return withUser(ctx.userId, async (tx) => {
    const [{ secret }] = await tx<{ secret: string | null }[]>`select app.mfa_pending_secret() as secret`
    if (!secret) throw invalid('Setup has expired. Start again.')
    const step = verifyTotp(decryptSecret(secret), code.replace(/\s/g, ''), 0)
    if (step === null) throw invalid('That code is not correct. Check the time on your phone and try the newest code.', { code: ['Incorrect code.'] })
    const codes = newRecoveryCodes()
    await tx`select app.mfa_finish_enrolment(${step}, ${tx.array(codes.map(hashRecoveryCode))}::text[])`
    return codes
  }, { ip: ctx.ip })
}

/** Reset someone's 2FA (lost phone): needs users.mfa_reset (MD by default) and a note of how their identity was verified. */
export async function adminResetMfa(ctx: Ctx, userId: string, reason: string) {
  if ((reason ?? '').trim().length < 10) throw invalid('Record how the person\'s identity was verified (at least 10 characters).', { reason: ['At least 10 characters.'] })
  return run(ctx, (tx) => tx`select app.mfa_admin_reset(${userId}, ${reason.trim()})`)
}
