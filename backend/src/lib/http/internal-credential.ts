import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

/**
 * Internal credential between the Next.js server (the only client of the Express API) and the Express API.
 *
 * Header:  X-ERP-Internal: v1.<ts>.<nonce>.<context>.<bodyDigest>.<signature>
 *   ts          Unix milliseconds when the Next.js server signed the request
 *   nonce       one-time request id (random UUID); the API accepts each nonce once
 *   context     base64url(JSON { ip, userAgent, origin, host }) as the browser sent them to Next.js; ip resolved there
 *               with the trusted-proxy rule (TRUST_PROXY)
 *   bodyDigest  base64url(SHA-256 of the exact request body); the API recomputes it while reading the body
 *   signature   base64url(HMAC-SHA256(INTERNAL_API_SECRET, canonical))
 *
 * canonical binds everything security-relevant: version, ts, nonce, method, path + raw query, SHA-256 of the forwarded
 * Cookie, Authorization and Content-Type headers, Content-Length, the body digest and the context. The API recomputes
 * every part from what it actually received, so changing any of them invalidates the signature.
 *
 * Pure functions with no module state (the secret is always passed in), shared by both sides.
 */

export const INTERNAL_HEADER = 'x-erp-internal'
export const CREDENTIAL_VERSION = 'v1'
/** Requests older than this, or signed more than FUTURE_SKEW_MS in the future, are refused. */
export const MAX_AGE_MS = 60_000
export const FUTURE_SKEW_MS = 5_000
/** Same limit as Next.js Server Actions (serverActions.bodySizeLimit '11mb'). */
export const MAX_BODY_BYTES = 11 * 1024 * 1024
export const MIN_SECRET_LENGTH = 32

export interface RequestContextClaims {
  ip: string | null
  userAgent: string
  origin: string | null
  host: string | null
}

/** The parts of a request covered by the signature. Header values are exactly as sent ('' when absent). */
export interface SignedRequestParts {
  method: string
  /** path + '?' + raw query, exactly as sent (e.g. '/api/reports/x?from=2026-01-01'). */
  pathWithQuery: string
  cookie: string
  authorization: string
  contentType: string
  /** The Content-Length header value; '0' when absent (no body). */
  contentLength: string
}

const b64url = (b: Buffer) => b.toString('base64url')
export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest()
export const bodyDigest = (body: Uint8Array) => b64url(sha256(body))
export const EMPTY_BODY_DIGEST = bodyDigest(new Uint8Array(0))

/** Canonical JSON of the context (fixed key order), so both sides hash the same bytes. */
export function encodeContext(c: RequestContextClaims): string {
  return b64url(Buffer.from(JSON.stringify({ ip: c.ip, userAgent: c.userAgent, origin: c.origin, host: c.host })))
}

export function canonicalString(ts: number, nonce: string, ctx: string, digest: string, p: SignedRequestParts): string {
  return [
    CREDENTIAL_VERSION,
    String(ts),
    nonce,
    p.method.toUpperCase(),
    p.pathWithQuery,
    b64url(sha256(p.cookie)),
    b64url(sha256(p.authorization)),
    b64url(sha256(p.contentType)),
    p.contentLength,
    digest,
    b64url(sha256(ctx)),
  ].join('\n')
}

const hmac = (secret: string, s: string) => b64url(createHmac('sha256', secret).update(s).digest())

/** Builds the header value for one request. A fresh nonce every time: never reuse a credential. */
export function signRequest(secret: string, parts: SignedRequestParts, context: RequestContextClaims, body: Uint8Array,
  opts: { now?: number; nonce?: string } = {}): string {
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new Error('INTERNAL_API_SECRET is not configured (at least 32 characters).')
  const ts = opts.now ?? Date.now()
  const nonce = opts.nonce ?? randomUUID()
  const ctx = encodeContext(context)
  const digest = bodyDigest(body)
  return [CREDENTIAL_VERSION, String(ts), nonce, ctx, digest, hmac(secret, canonicalString(ts, nonce, ctx, digest, parts))].join('.')
}

export type CredentialCheck =
  | { ok: true; ts: number; nonce: string; context: RequestContextClaims; claimedDigest: string }
  | { ok: false; reason: 'missing' | 'malformed' | 'version' | 'expired' | 'future' | 'before_start' | 'signature' }

const NONCE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const B64URL_RE = /^[A-Za-z0-9_-]+$/

/**
 * Checks format, time window and signature (the body digest is checked later, against the body actually received).
 * Constant-time comparison; never throws on hostile input.
 */
export function verifyCredential(secret: string, header: string | undefined, parts: SignedRequestParts,
  opts: { now?: number; notBefore?: number } = {}): CredentialCheck {
  if (!header) return { ok: false, reason: 'missing' }
  const f = header.split('.')
  if (f.length !== 6) return { ok: false, reason: 'malformed' }
  const [version, tsText, nonce, ctx, digest, sig] = f
  if (version !== CREDENTIAL_VERSION) return { ok: false, reason: 'version' }
  if (!/^\d{13}$/.test(tsText) || !NONCE_RE.test(nonce) || !B64URL_RE.test(ctx) || ctx.length > 4096 || !B64URL_RE.test(digest) || digest.length !== 43 || !B64URL_RE.test(sig) || sig.length !== 43) {
    return { ok: false, reason: 'malformed' }
  }
  const ts = Number(tsText)
  const now = opts.now ?? Date.now()
  if (ts < now - MAX_AGE_MS) return { ok: false, reason: 'expired' }
  if (ts > now + FUTURE_SKEW_MS) return { ok: false, reason: 'future' }
  if (opts.notBefore !== undefined && ts < opts.notBefore) return { ok: false, reason: 'before_start' }
  const expected = Buffer.from(hmac(secret, canonicalString(ts, nonce, ctx, digest, parts)))
  const given = Buffer.from(sig)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'signature' }
  let context: RequestContextClaims
  try {
    const c = JSON.parse(Buffer.from(ctx, 'base64url').toString('utf8'))
    const str = (v: unknown) => (typeof v === 'string' ? v : null)
    context = { ip: str(c.ip), userAgent: str(c.userAgent) ?? '', origin: str(c.origin), host: str(c.host) }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  return { ok: true, ts, nonce, context, claimedDigest: digest }
}

/** Constant-time comparison of two base64url digests. */
export function digestsEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
