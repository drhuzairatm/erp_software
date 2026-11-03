import type { RequestHandler } from 'express'
import { parseCookieHeader, type RequestStore, requestStore } from '../lib/http/context-provider'
import type { VerifiedRequest } from './internal-gate'

/** Forwarded request headers shared server code may read (besides the signed context). */
const READABLE = ['accept', 'accept-language', 'content-type'] as const

/**
 * Creates a NEW request store for every API request and runs the rest of the request inside it (AsyncLocalStorage).
 * Filled only from the verified request: client address, user agent, origin and host from the signed context; cookies
 * from the signed Cookie header. Client-supplied X-Forwarded-*, X-Real-IP etc. are never read.
 */
export function requestContext(): RequestHandler {
  return (req, res, next) => {
    const v = res.locals.erp as VerifiedRequest | undefined
    if (!v) return next(new Error('request context without a verified request'))
    const headers = new Headers()
    for (const n of READABLE) { const x = req.headers[n]; if (typeof x === 'string') headers.set(n, x) }
    headers.set('user-agent', v.context.userAgent)
    const store: RequestStore = {
      headers,
      cookies: parseCookieHeader(typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined),
      setCookies: [],
      ip: v.context.ip,
      origin: v.context.origin,
      host: v.context.host,
    }
    requestStore.run(store, () => next())
  }
}
