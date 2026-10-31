import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { anonymous, withUser } from '../db'
import { type AuthContext, loadMemberships } from './context'
import { mfaRequired } from './mfa'
import { getDummyHash, verifyPassword } from './password'
import { hashToken, newTokenValue } from './tokens'

const SESSION_TTL_HOURS = 12
const MAX_FAILURES_PER_EMAIL = 5
const MAX_FAILURES_PER_IP = 30

export const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-erp_session' : 'erp_session'

export { hashToken }

export async function clientIp(): Promise<string | null> {
  const h = await headers()
  const fwd = h.get('x-forwarded-for')
  return (fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip')) || null
}

export type LoginResult = { ok: true; mustChangePassword: boolean; mfaPending: boolean } | { ok: false; message: string }

export async function login(email: string, password: string): Promise<LoginResult> {
  const ip = await clientIp()
  const h = await headers()
  const generic = { ok: false as const, message: 'Incorrect email or password.' }
  return anonymous(async (tx) => {
    const [rate] = await tx<{ email_failures: number; ip_failures: number }[]>`select * from app.auth_recent_failures(${email}, ${ip ?? ''})`
    if (rate.email_failures >= MAX_FAILURES_PER_EMAIL || rate.ip_failures >= MAX_FAILURES_PER_IP) {
      await tx`select app.auth_record_attempt(${email}, ${ip ?? ''}, false, null)`
      return { ok: false as const, message: 'Too many failed attempts. Please wait 15 minutes and try again, or ask an administrator to reset your password.' }
    }
    const [user] = await tx<{ user_id: string; password_hash: string; must_change_password: boolean }[]>`select * from app.auth_login_lookup(${email})`
    const ok = await verifyPassword(user?.password_hash ?? (await getDummyHash()), password)
    if (!user || !ok) {
      await tx`select app.auth_record_attempt(${email}, ${ip ?? ''}, false, ${user?.user_id ?? null})`
      return generic
    }
    const token = newTokenValue()
    const [{ mfa }] = await tx<{ mfa: boolean }[]>`select app.auth_mfa_enabled(${user.user_id}) as mfa`
    // With 2FA enabled the session starts "pending" (10 minutes) until the code is entered.
    await tx`select app.auth_create_session(${user.user_id}, ${hashToken(token)}, ${SESSION_TTL_HOURS}, ${ip}, ${h.get('user-agent') ?? ''}, ${mfa})`
    await tx`select app.auth_record_attempt(${email}, ${ip ?? ''}, true, ${user.user_id})`
    const jar = await cookies()
    jar.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_HOURS * 3600,
    })
    return { ok: true as const, mustChangePassword: user.must_change_password, mfaPending: mfa }
  }, { ip })
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
