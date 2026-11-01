import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { anonymous, withUser } from '../db'
import { type AuthContext, loadMemberships } from './context'
import { mfaRequired } from './mfa'
import { getDummyHash, verifyPassword } from './password'
import { hashToken, newTokenValue } from './tokens'
import { deviceHash, readDeviceToken, STAFF_DEVICE_COOKIE } from './trusted-device'
import { resolveClientIp } from '@/lib/client-ip'

const SESSION_TTL_HOURS = 12

export const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-erp_session' : 'erp_session'

export { hashToken }

/** Client address from a header set by the TRUSTED proxy only (TRUST_PROXY; see src/lib/client-ip.ts). null = unknown. */
export async function clientIp(): Promise<string | null> {
  return resolveClientIp(await headers())
}

export type LoginResult = { ok: true; mustChangePassword: boolean; mfaPending: boolean } | { ok: false; message: string }

export const LOCKED_MESSAGE =
  'Too many failed attempts from this browser. Wait 15 minutes, sign in from a computer or phone you have used before, or use "Forgot your password?".'

/**
 * Password sign-in (finding N-1):
 *   1. one short database step takes a per-email lock, counts recent failures and RESERVES this attempt (it counts as a
 *      failure until the password is confirmed), so parallel attempts can never exceed the limit;
 *   2. the password is checked here, outside any lock;
 *   3. the attempt is finished (session created, or failure recorded in the audit log).
 * Limits: unrecognised browsers 5 failures per email per 15 minutes (shared), a trusted browser 10 of its own,
 * 30 per address when the address is known (TRUST_PROXY). Two-step login is unaffected.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const ip = await clientIp()
  const h = await headers()
  const jar = await cookies()
  const generic = { ok: false as const, message: 'Incorrect email or password.' }
  const device = deviceHash(readDeviceToken(jar, STAFF_DEVICE_COOKIE))
  const [a] = await anonymous((tx) => tx<{ attempt_id: string | null; allowed: boolean; user_id: string | null; password_hash: string | null; trusted: boolean }[]>`
    select * from app.auth_begin_attempt(${email}, ${ip}, ${device})`, { ip })
  if (!a?.allowed) return { ok: false as const, message: LOCKED_MESSAGE }
  // unknown accounts are checked against a dummy hash, so both cases take the same time
  const passwordOk = await verifyPassword(a.password_hash ?? (await getDummyHash()), password)
  const ok = passwordOk && !!a.user_id
  const token = newTokenValue()
  const [r] = await anonymous((tx) => tx<{ ok: boolean; mfa_pending: boolean; must_change_password: boolean }[]>`
    select * from app.auth_finish_attempt(${a.attempt_id}, ${ok}, ${ok ? hashToken(token) : null}, ${SESSION_TTL_HOURS}, ${ip}, ${h.get('user-agent') ?? ''})`, { ip })
  if (!r?.ok) return generic
  // With 2FA enabled the session starts "pending" (10 minutes) until the code is entered.
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 3600,
  })
  return { ok: true as const, mustChangePassword: r.must_change_password, mfaPending: r.mfa_pending }
}

export async function logout() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) {
    await anonymous((tx) => tx`select app.auth_revoke_session(${hashToken(token)})`)
  }
  jar.delete(SESSION_COOKIE)
}

/** Resolve the current session (memoised per request). Returns null if not logged in. */
export const getSession = cache(async (): Promise<AuthContext | null> => {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token || token.length > 100) return null
  const ip = await clientIp()
  const [s] = await anonymous((tx) => tx<{ session_id: string; user_id: string; must_change_password: boolean; mfa_pending: boolean; mfa_enabled: boolean }[]>`
    select * from app.auth_resolve_session(${hashToken(token)})`)
  // A session still waiting for its two-factor code is NOT signed in.
  if (!s || s.mfa_pending) return null
  return withUser(s.user_id, async (tx) => {
    const [u] = await tx<{ email: string; full_name: string; job_title: string | null }[]>`
      select email, full_name, job_title from user_profiles where id = ${s.user_id}`
    if (!u) return null
    const memberships = await loadMemberships(tx, s.user_id)
    return {
      userId: s.user_id,
      sessionId: s.session_id,
      email: u.email,
      fullName: u.full_name,
      jobTitle: u.job_title,
      mustChangePassword: s.must_change_password,
      mfaEnabled: s.mfa_enabled,
      mfaSetupRequired: !s.mfa_enabled && mfaRequired(memberships.map((m) => m.roleRequiresMfa)),
      memberships,
      ip,
    }
  })
})

/** For pages and actions: require a logged-in user, else redirect to login. */
export async function requireUser(opts: { allowPasswordChange?: boolean; allowMfaSetup?: boolean } = {}): Promise<AuthContext> {
  const ctx = await getSession()
  if (!ctx) redirect('/login')
  if (ctx.mustChangePassword && !opts.allowPasswordChange) redirect('/account/password?required=1')
  if (ctx.mfaSetupRequired && !opts.allowMfaSetup && !(opts.allowPasswordChange && ctx.mustChangePassword)) redirect('/account/security?required=1')
  return ctx
}

/** For API routes: a fully signed-in user who has completed required setup steps, or null. */
export async function getActiveSession(): Promise<AuthContext | null> {
  const ctx = await getSession()
  if (!ctx || ctx.mustChangePassword || ctx.mfaSetupRequired) return null
  return ctx
}

/** The sign-in that is waiting for a two-factor code (token hash), if any. */
export async function getPendingMfaToken(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token || token.length > 100) return null
  const [s] = await anonymous((tx) => tx<{ mfa_pending: boolean }[]>`select mfa_pending from app.auth_resolve_session(${hashToken(token)})`)
  return s?.mfa_pending ? hashToken(token) : null
}

export const SESSION_TTL = SESSION_TTL_HOURS
