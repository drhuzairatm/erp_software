import { AsyncLocalStorage } from 'node:async_hooks'
import type { CookieJar, CookieOptions, RequestContextProvider, RequestHeaders } from './request-context'

/**
 * Express request-context provider (the default for backend builds). Every API request gets its OWN store, created by
 * the request-context middleware from the verified internal credential (client address, user agent, origin, host) and
 * the signed, forwarded cookies. Nothing is kept at module level: outside a request every accessor throws, so request
 * data can never come from another request or from a fallback.
 */
export interface RequestStore {
  /** Forwarded request headers (allow-listed by the Next.js server; user-agent from the signed context). */
  headers: Headers
  /** Incoming cookies (from the signed Cookie header). Updated by set/delete, like a browser would see them. */
  cookies: Map<string, string>
  /** Set-Cookie header values to send with this request's response, in order. */
  setCookies: string[]
  ip: string | null
  origin: string | null
  host: string | null
}

export const requestStore = new AsyncLocalStorage<RequestStore>()

export class NoRequestContextError extends Error {
  constructor() { super('No request context: request data was read outside an API request.') }
}

/** Raised instead of a browser redirect; the API turns it into an explicit response for the Next.js server. */
export class RedirectRequired extends Error {
  constructor(public location: string) { super(`Redirect required: ${location}`) }
}

function store(): RequestStore {
  const s = requestStore.getStore()
  if (!s) throw new NoRequestContextError()
  return s
}

/** Cookie header parsing as browsers send it ("a=b; c=d"); the first occurrence of a name wins. */
export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    const name = part.slice(0, i).trim()
    let value = part.slice(i + 1).trim()
    try { value = decodeURIComponent(value) } catch { /* keep the raw value */ }
    if (name && !out.has(name)) out.set(name, value)
  }
  return out
}

/** Set-Cookie serialisation (attribute order and spelling as Next.js / @edge-runtime/cookies). */
export function serializeCookie(name: string, value: string, o: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (o.path) parts.push(`Path=${o.path}`)
  if (o.expires !== undefined) parts.push(`Expires=${(typeof o.expires === 'number' ? new Date(o.expires) : o.expires).toUTCString()}`)
  if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`)
  if (o.domain) parts.push(`Domain=${o.domain}`)
  if (o.secure) parts.push('Secure')
  if (o.httpOnly) parts.push('HttpOnly')
  if (o.sameSite) parts.push(`SameSite=${o.sameSite === true ? 'strict' : o.sameSite}`)
  return parts.join('; ')
}

const jar = (s: RequestStore): CookieJar => ({
  get: (name) => (s.cookies.has(name) ? { name, value: s.cookies.get(name)! } : undefined),
  set: (name, value, options) => { s.cookies.set(name, value); s.setCookies.push(serializeCookie(name, value, options)) },
  delete: (arg) => {
    const { name, path, domain } = typeof arg === 'string' ? { name: arg, path: '/', domain: undefined } : { path: '/', ...arg }
    s.cookies.delete(name)
    s.setCookies.push(serializeCookie(name, '', { path, domain, expires: new Date(0) }))
  },
})

export const provider: RequestContextProvider = {
  headers: async (): Promise<RequestHeaders> => store().headers,
  cookies: async () => jar(store()),
  clientIp: async () => store().ip,
  redirect(url: string): never { throw new RedirectRequired(url) },
}
