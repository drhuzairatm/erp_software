import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ServiceError } from '@/lib/errors'
import { RedirectRequired } from '../lib/http/context-provider'
import { sendExact, sendJson } from '../lib/send'

const STATUS: Record<ServiceError['kind'], number> = { unauthenticated: 401, forbidden: 403, not_found: 404, invalid: 422, conflict: 409, unknown: 500 }

/** Unknown API paths: 404 with an empty body. */
export const notFound: RequestHandler = (_req, res) => sendExact(res, 404, { 'Cache-Control': 'no-store' })

/**
 * Errors become explicit responses for the Next.js server (the only client):
 * - a redirect requested by shared server code (e.g. "sign in first") → 401 { reason: 'redirect', location };
 * - a ServiceError (message safe for users) → its status + { message, fieldErrors };
 * - anything else → 500 with the same generic message the app shows today; details are logged on the server only,
 *   never request data.
 */
export function errorHandler(log: (e: Record<string, unknown>) => void = (e) => console.error(JSON.stringify(e))): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (res.headersSent) { res.destroy(); return }
    if (err instanceof RedirectRequired) return sendJson(res, 401, { reason: 'redirect', location: err.location }, { 'Cache-Control': 'no-store' })
    if (err instanceof ServiceError) return sendJson(res, STATUS[err.kind], { message: err.message, fieldErrors: err.fieldErrors }, { 'Cache-Control': 'no-store' })
    log({ level: 'error', msg: 'unexpected API error', error: err instanceof Error ? { name: err.name, message: err.message } : String(err) })
    return sendJson(res, 500, { message: 'Something went wrong. Please try again.' }, { 'Cache-Control': 'no-store' })
  }
}
