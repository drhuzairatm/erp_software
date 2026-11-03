import 'server-only'
import { type CookieJar, requestCookies as cookies } from '../http/request-context'
import { anonymous } from '../db'
import { hashToken, newTokenValue } from './tokens'

/**
 * Trusted browsers (finding N-1). A browser that completed a full staff sign-in (password + two-step code), or that
 * completed a password reset, receives a random 256-bit cookie; the database stores only its SHA-256 hash.
 *
 * The cookie is NOT a credential and never skips two-step login. It only selects which failed-sign-in counter applies:
 * failures from unrecognised browsers are counted per email (5 per 15 minutes), a trusted browser has its own counter
 * (10 per 15 minutes). So someone who only knows an email address cannot lock the person out of the browser they use.
 * Trust ends on every account-security event (password change or reset, two-step reset, suspension/termination,
 * sign out everywhere) and after 90 days.
 */
const PROD = process.env.NODE_ENV === 'production'
export const STAFF_DEVICE_COOKIE = PROD ? '__Host-erp_device' : 'erp_device'
export const PORTAL_DEVICE_COOKIE = PROD ? '__Secure-erp_portal_device' : 'erp_portal_device'
const MAX_AGE_SECONDS = 90 * 24 * 3600

type Jar = CookieJar

/** The cookie value if it is well-formed (43 base64url characters), else null. */
export function readDeviceToken(jar: Pick<Jar, 'get'>, name: string): string | null {
  const v = jar.get(name)?.value
  return v && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null
}

export const deviceHash = (token: string | null) => (token ? hashToken(token) : null)

export function setDeviceCookie(jar: Pick<Jar, 'set'>, name: string, token: string, path: string) {
  jar.set(name, token, { httpOnly: true, secure: PROD, sameSite: 'lax', path, maxAge: MAX_AGE_SECONDS })
}

/** Current staff browser token hash (or null). */
export async function currentStaffDeviceHash(): Promise<string | null> {
  return deviceHash(readDeviceToken(await cookies(), STAFF_DEVICE_COOKIE))
}

/** Generate a new browser token; returns the value (for the cookie) and its hash (for the database). */
export function newDeviceToken() {
  const token = newTokenValue()
  return { token, hash: hashToken(token) }
}

/**
 * After the two-step code was accepted: keep or add this browser as trusted. The database only accepts this for a
 * session that has just completed its two-step step on an account with two-step login switched on.
 */
export async function trustStaffBrowserAfterMfa(sessionTokenHash: string): Promise<'kept' | 'added' | null> {
  const jar = await cookies()
  const current = deviceHash(readDeviceToken(jar, STAFF_DEVICE_COOKIE))
  const fresh = newDeviceToken()
  const [r] = await anonymous((tx) => tx<{ r: 'kept' | 'added' | null }[]>`select app.auth_trust_device_after_mfa(${sessionTokenHash}, ${current}, ${fresh.hash}) as r`)
  if (r?.r === 'added') setDeviceCookie(jar, STAFF_DEVICE_COOKIE, fresh.token, '/')
  return r?.r ?? null
}
