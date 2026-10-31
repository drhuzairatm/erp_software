import 'server-only'
import { anonymous, withUser } from '../db'
import { appUrl, emailConfigured, sendEmail } from '../email'
import { invalid } from '../errors'
import { checkPasswordStrength, hashPassword, verifyPassword } from './password'
import { clientIp } from './session'
import { hashToken, newTokenValue } from './tokens'

/**
 * Self-service reset request. Always returns the same neutral response so the
 * form cannot be used to discover which emails have accounts.
 */
export async function requestPasswordReset(email: string) {
  const ip = await clientIp()
  const cleaned = email.trim().toLowerCase().slice(0, 200)
  if (!cleaned.includes('@')) return
  await anonymous(async (tx) => {
    const [rate] = await tx<{ email_failures: number; ip_failures: number }[]>`select * from app.auth_recent_failures(${cleaned}, ${ip ?? ''})`
    if (rate.ip_failures >= 30) return
    const token = newTokenValue()
    const [user] = await tx<{ user_id: string; email: string; full_name: string }[]>`select * from app.auth_request_reset(${cleaned}, ${hashToken(token)})`
    // Count requests towards the rate limit like failed logins
    await tx`select app.auth_record_attempt(${cleaned}, ${ip ?? ''}, false, null)`
    if (user && emailConfigured()) {
      await sendEmail(user.email, 'Reset your password',
        `Hello ${user.full_name},\n\nUse this link within 1 hour to set a new password:\n${appUrl('/reset-password/' + token)}\n\nIf you did not ask for this, ignore this email.`)
    }
  }, { ip })
}

export async function resetTokenValid(token: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return false
  const [r] = await anonymous((tx) => tx<{ ok: boolean }[]>`select app.auth_reset_is_valid(${hashToken(token)}) as ok`)
  return r.ok
}

export async function completePasswordReset(token: string, password: string, confirm: string) {
  if (password !== confirm) throw invalid('Passwords do not match.', { confirm: ['Passwords do not match.'] })
  const weak = checkPasswordStrength(password)
  if (weak) throw invalid(weak, { password: [weak] })
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) throw invalid('This link is invalid or has expired.')
  const hash = await hashPassword(password)
  const [r] = await anonymous((tx) => tx<{ user_id: string | null }[]>`select app.auth_complete_reset(${hashToken(token)}, ${hash}) as user_id`)
  if (!r.user_id) throw invalid('This link is invalid or has expired. Ask an administrator for a new one.')
}

export async function changeOwnPassword(userId: string, sessionId: string, email: string, current: string, next: string) {
  const weak = checkPasswordStrength(next, email)
  if (weak) throw invalid(weak, { next: [weak] })
  await withUser(userId, async (tx) => {
    const [{ hash }] = await tx<{ hash: string | null }[]>`select app.auth_own_password_hash() as hash`
    if (!hash || !(await verifyPassword(hash, current))) throw invalid('Your current password is incorrect.', { current: ['Incorrect password.'] })
    if (await verifyPassword(hash, next)) throw invalid('Choose a password different from your current one.', { next: ['Must be different.'] })
    await tx`select app.auth_change_own_password(${await hashPassword(next)}, ${sessionId})`
  })
}
