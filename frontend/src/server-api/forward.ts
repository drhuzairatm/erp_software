import 'server-only'
import { resolveClientIp } from '@/lib/client-ip'
import { SESSION_COOKIE } from '@/lib/auth/session'
import { PORTAL_DEVICE_COOKIE, STAFF_DEVICE_COOKIE } from '@/lib/auth/trusted-device'
import { INTERNAL_HEADER, MIN_SECRET_LENGTH, type RequestContextClaims, type SignedRequestParts, signRequest } from '@/lib/http/internal-credential'
import { PORTAL_COOKIE } from '@/services/portal'
import { SCOPE_COOKIE } from '@/services/scope'

/**
 * The Next.js server side of the internal API boundary (BFF). The ONLY code that sends requests to the Express API.
 *
 * Every request gets a NEW header set built from an allow-list; nothing else from the browser is copied:
 *   Cookie            only the ERP's own cookies (session, trusted browser, portal, portal browser, company scope), in a
 *                     fixed order, values unchanged
 *   User-Agent, Accept, Accept-Language
 *   Content-Type      for requests with a body (Content-Length is set by fetch from the exact body)
 *   Authorization     only when the caller passes it explicitly (the two cron routes)
 * Never copied: X-ERP-Internal, X-Forwarded-*, X-Real-IP, Forwarded, Host or any other header.
 * The client address is resolved here with the existing trusted-proxy rule (TRUST_PROXY) and travels only inside the
 * signed credential. No automatic retries: a failed call is never repeated (each attempt would be a new request).
 */

/** In this order; any other cookie is dropped. */
export const FORWARDED_COOKIES = [SESSION_COOKIE, STAFF_DEVICE_COOKIE, PORTAL_COOKIE, PORTAL_DEVICE_COOKIE, SCOPE_COOKIE]
const FORWARDED_HEADERS = ['user-agent', 'accept', 'accept-language'] as const

export class ApiUnavailableError extends Error {
  constructor(public reason: 'not_configured' | 'unreachable') { super(`internal API ${reason}`) }
}

/**
 * One path segment for an API path built from a route parameter (already decoded by Next.js). Percent-encoded, so it
 * can never add or change path segments. URLs treat "." and ".." (also as %2e) as dot segments and remove them, so a
 * dot-only value is sent as "..." instead: still not a valid id, and the API answers exactly as for any other invalid id.
 */
export function apiPathSegment(value: string): string {
  return /^\.{1,2}$/.test(value) ? '...' : encodeURIComponent(value)
}

export const apiBaseUrl = () => process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'

/** The browser's Cookie header reduced to the ERP cookies (first occurrence of each, raw values, fixed order). */
export function filterCookieHeader(raw: string | null): string {
  const found = new Map<string, string>()
  for (const part of (raw ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    const name = part.slice(0, i).trim()
    if (FORWARDED_COOKIES.includes(name) && !found.has(name)) found.set(name, part.trim())
  }
  return FORWARDED_COOKIES.filter((n) => found.has(n)).map((n) => found.get(n)!).join('; ')
}

/** What the browser sent to this server, with the client address from the trusted-proxy rule only. */
export function contextFrom(h: Pick<Headers, 'get'>): RequestContextClaims {
  return {
    ip: resolveClientIp(h),
    userAgent: h.get('user-agent') ?? '',
    origin: h.get('origin'),
    host: h.get('x-forwarded-host') ?? h.get('host'),
  }
}

export interface ForwardRequest {
  method: string
  /** API path, optionally with a query string, e.g. '/api/health'. */
  path: string
  /** The incoming browser request's headers (route handler `req.headers`, or next/headers in actions). */
  incoming: Pick<Headers, 'get'>
  body?: Uint8Array<ArrayBuffer>
  contentType?: string
  /** Only for the cron routes: the Authorization header to pass on (also covered by the signature). */
  authorization?: string
  timeoutMs?: number
}

let warnedNotConfigured = false

export async function forwardToApi(r: ForwardRequest): Promise<Response> {
  const secret = process.env.INTERNAL_API_SECRET ?? ''
  if (secret.length < MIN_SECRET_LENGTH) {
    if (!warnedNotConfigured) console.error(JSON.stringify({ level: 'error', msg: 'INTERNAL_API_SECRET is not configured: the API cannot be called.' }))
    warnedNotConfigured = true
    throw new ApiUnavailableError('not_configured')
  }
  const method = r.method.toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const body = hasBody ? (r.body ?? new Uint8Array(0)) : new Uint8Array(0)
  const url = new URL(r.path, apiBaseUrl())

  const headers = new Headers()
  const cookie = filterCookieHeader(r.incoming.get('cookie'))
  if (cookie) headers.set('cookie', cookie)
  for (const n of FORWARDED_HEADERS) { const v = r.incoming.get(n); if (v !== null) headers.set(n, v) }
  if (hasBody && r.contentType) headers.set('content-type', r.contentType)
  if (r.authorization) headers.set('authorization', r.authorization)

  const parts: SignedRequestParts = {
    method,
    pathWithQuery: url.pathname + url.search,
    cookie,
    authorization: r.authorization ?? '',
    contentType: hasBody ? (r.contentType ?? '') : '',
    contentLength: hasBody ? String(body.byteLength) : '0',
  }
  headers.set(INTERNAL_HEADER, signRequest(secret, parts, contextFrom(r.incoming), body))
  try {
    return await fetch(url, { method, headers, body: hasBody ? body : undefined, redirect: 'manual', signal: AbortSignal.timeout(r.timeoutMs ?? 30_000) })
  } catch {
    throw new ApiUnavailableError('unreachable')
  }
}
