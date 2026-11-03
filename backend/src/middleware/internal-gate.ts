import { createHash } from 'node:crypto'
import type { Request, RequestHandler, Response } from 'express'
import {
  digestsEqual, INTERNAL_HEADER, MAX_BODY_BYTES, type RequestContextClaims, type SignedRequestParts, verifyCredential,
} from '@/lib/http/internal-credential'
import type { ReplayCache } from '../lib/replay-cache'

/** What the gate hands to later middleware (res.locals.erp). */
export interface VerifiedRequest {
  nonce: string
  context: RequestContextClaims
  /** The exact request body (verified against the signed digest). Empty for GET. */
  body: Buffer
}

export interface GateOptions {
  secret: string
  replay: ReplayCache
  /** Credentials signed before this time are refused (the replay store is empty after a restart). */
  notBefore: number
  now?: () => number
  maxBody?: number
  log?: (entry: Record<string, unknown>) => void
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : v) ?? ''

/**
 * Runs first on every API request, before anything reads the body or calls a service:
 *   1. credential: format, time window (−60 s / +5 s), signed after this process started, HMAC over method, path + query,
 *      Cookie, Authorization, Content-Type, Content-Length, claimed body digest and context (constant-time);
 *   2. one-time nonce (duplicate → refused; store full → 503, fail closed);
 *   3. size: Content-Length required for bodies (no chunked bodies), at most 11 MB, refused before reading;
 *   4. body read as a stream through a counter and SHA-256; at the end the digest must equal the signed one.
 * Only then does the request continue. Refusals: 404 with an empty body (no detail for a caller without the secret),
 * 411 / 413 for framing and size, 503 when the nonce store is full. Logged without header values, cookies or body.
 */
export function internalGate(o: GateOptions): RequestHandler {
  const now = o.now ?? Date.now
  const maxBody = o.maxBody ?? MAX_BODY_BYTES
  const log = o.log ?? ((e) => console.warn(JSON.stringify(e)))

  return (req: Request, res: Response, next) => {
    const refuse = (status: number, reason: string, nonce?: string) => {
      log({ level: 'warn', msg: 'internal API request refused', reason, status, nonce: nonce?.slice(0, 8) })
      if (!res.headersSent) res.status(status).set('Connection', 'close').end()
      // never read an unwanted body
      if (!req.complete) req.destroy()
    }

    const contentLength = one(req.headers['content-length']) || '0'
    const parts: SignedRequestParts = {
      method: req.method,
      pathWithQuery: req.originalUrl,
      cookie: one(req.headers.cookie),
      authorization: one(req.headers.authorization),
      contentType: one(req.headers['content-type']),
      contentLength,
    }
    const check = verifyCredential(o.secret, one(req.headers[INTERNAL_HEADER]) || undefined, parts, { now: now(), notBefore: o.notBefore })
    if (!check.ok) return refuse(404, check.reason)

    const reserved = o.replay.reserve(check.nonce, check.ts)
    if (reserved === 'duplicate') return refuse(404, 'replay', check.nonce)
    if (reserved === 'full') return refuse(503, 'replay_cache_full', check.nonce)

    if (req.headers['transfer-encoding']) return refuse(411, 'chunked_body', check.nonce)
    if (!/^\d+$/.test(contentLength)) return refuse(404, 'bad_length', check.nonce)
    const declared = Number(contentLength)
    if (declared > maxBody) return refuse(413, 'too_large', check.nonce)

    const hash = createHash('sha256')
    const chunks: Buffer[] = []
    let received = 0
    let done = false
    req.on('data', (c: Buffer) => {
      if (done) return
      received += c.length
      if (received > declared || received > maxBody) { done = true; return refuse(413, 'too_large', check.nonce) }
      hash.update(c)
      chunks.push(c)
    })
    req.on('error', () => { if (!done) { done = true; refuse(400, 'body_error', check.nonce) } })
    req.on('end', () => {
      if (done) return
      done = true
      if (received !== declared) return refuse(404, 'length_mismatch', check.nonce)
      if (!digestsEqual(hash.digest('base64url'), check.claimedDigest)) return refuse(404, 'digest', check.nonce)
      res.locals.erp = { nonce: check.nonce, context: check.context, body: Buffer.concat(chunks) } satisfies VerifiedRequest
      next()
    })
  }
}
