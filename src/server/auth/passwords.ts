import 'server-only'
import { anonymous, withUser } from '../db'
import { appUrl } from '../email'
import { invalid } from '../errors'
import { encryptSecret } from './mfa'
import { checkPasswordStrength, hashPassword, verifyPassword } from './password'
import { clientIp } from './session'
import { hashToken, newTokenValue } from './tokens'

/**
 * Self-service reset request (finding N-1). Always returns nothing, so the form cannot reveal which emails have
 * accounts, and it does the same work for every address:
 *   - one database call records the request and applies the limits (3 per hour and 1 per 2 minutes per email,
 *     10 per hour per address when known, 100 reset emails per hour system-wide);
 *   - for an existing account within the limits it stores the token hash and queues the email in the dedicated
 *     staff email queue, with the link ENCRYPTED; no email is ever sent during the request itself;
 *   - a reset request is NEVER counted as a failed sign-in, so it cannot lock anyone out.
 * Delivery: deliverStaffEmails() (cron every minute; also triggered right after the request).
 */
export async function requestPasswordReset(email: string) {
  const ip = await clientIp()
  const cleaned = email.trim().toLowerCase().slice(0, 200)
  if (!cleaned.includes('@')) return
  const token = newTokenValue()
  const link = encryptSecret(appUrl('/reset-password/' + token))
  await anonymous((tx) => tx`select app.auth_request_reset_limited(${cleaned}, ${ip}, ${hashToken(token)}, ${link})`, { ip })
}

export async function resetTokenValid(token: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return false
  const [r] = await anonymous((tx) => tx<{ ok: boolean }[]>`select app.auth_reset_is_valid(${hashToken(token)}) as ok`)
  return r.ok
}

/**
 * Complete a reset. Recovery (finding N-1): this proves control of the mailbox, so it also clears the email's
 * failed-sign-in count for unrecognised browsers and, when `deviceTokenHash` is given, trusts this browser.
 * Two-step login is still required at the next sign-in.
 */
export async function completePasswordReset(token: string, password: string, confirm: string, deviceTokenHash: string | null = null) {
  if (password !== confirm) throw invalid('Passwords do not match.', { confirm: ['Passwords do not match.'] })
  const weak = checkPasswordStrength(password)
  if (weak) throw invalid(weak, { password: [weak] })
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) throw invalid('This link is invalid or has expired.')
  const hash = await hashPassword(password)
  const [r] = await anonymous((tx) => tx<{ user_id: string | null }[]>`select app.auth_complete_reset_trusted(${hashToken(token)}, ${hash}, ${deviceTokenHash}) as user_id`)
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

/** Staff invitation: details for a valid, unexpired, unused invitation (null otherwise). */
export async function invitationInfo(token: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null
  const [r] = await anonymous((tx) => tx<{ full_name: string; email: string; expires_at: Date }[]>`select * from app.auth_invitation_info(${hashToken(token)})`)
  return r ?? null
}

/** Accepting the invitation sets the private password, confirms the email address and activates the account. */
export async function acceptInvitation(token: string, password: string, confirm: string) {
  if (password !== confirm) throw invalid('Passwords do not match.', { confirm: ['Passwords do not match.'] })
  const info = await invitationInfo(token)
  if (!info) throw invalid('This invitation is invalid, has already been used, or has expired. Ask your administrator for a new one.')
  const weak = checkPasswordStrength(password, info.email)
  if (weak) throw invalid(weak, { password: [weak] })
  const hash = await hashPassword(password)
  const [r] = await anonymous((tx) => tx<{ user_id: string | null }[]>`select app.auth_accept_invitation(${hashToken(token)}, ${hash}) as user_id`)
  if (!r.user_id) throw invalid('This invitation is invalid, has already been used, or has expired. Ask your administrator for a new one.')
}
