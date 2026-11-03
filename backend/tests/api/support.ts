import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type AppOptions, createApp } from '../../src/app'
import { type RequestContextClaims, type SignedRequestParts, signRequest } from '../../src/lib/http/internal-credential'

/** Test-only secret from tests/support/test-env.ts (never a real value). */
export const SECRET = process.env.INTERNAL_API_SECRET!

/** Starts the real Express app in this process on a random loopback port. Refusal logs are collected, not printed. */
export async function startApi(o: Partial<AppOptions> = {}) {
  const logs: Record<string, unknown>[] = []
  const { app, replay, startedAt } = createApp({ secret: SECRET, log: (e) => logs.push(e), ...o })
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const close = () => new Promise<void>((resolve) => { replay.stop(); server.closeAllConnections(); server.close(() => resolve()) })
  return { base, server, replay, logs, startedAt, close }
}

export interface Req {
  method?: string
  path: string
  cookie?: string
  authorization?: string
  contentType?: string
  body?: Uint8Array<ArrayBuffer>
  context?: Partial<RequestContextClaims>
  /** Extra headers sent but NOT part of the signature (e.g. spoofed proxy headers). */
  extraHeaders?: Record<string, string>
}

export const ctx = (c: Partial<RequestContextClaims> = {}): RequestContextClaims => ({ ip: '203.0.113.10', userAgent: 'vitest-api', origin: null, host: null, ...c })

/** The signed parts as the Next.js server computes them for this request. */
export function partsOf(r: Req): SignedRequestParts {
  const method = (r.method ?? 'GET').toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return {
    method,
    pathWithQuery: r.path,
    cookie: r.cookie ?? '',
    authorization: r.authorization ?? '',
    contentType: hasBody ? (r.contentType ?? '') : '',
    contentLength: hasBody ? String((r.body ?? new Uint8Array(0)).byteLength) : '0',
  }
}

/** A credential for `signed`. Options allow a chosen time or nonce, or signing a different body than the one sent. */
export function credentialFor(signed: Req, o: { now?: number; nonce?: string; signedBody?: Uint8Array } = {}) {
  return signRequest(SECRET, partsOf(signed), ctx(signed.context), o.signedBody ?? signed.body ?? new Uint8Array(0), { now: o.now, nonce: o.nonce })
}

/**
 * Sends `sent` with a credential. By default the credential is for the same request; pass `credential` to send a
 * credential made for something else (tampering tests) or null to send none.
 */
export async function send(base: string, sent: Req, credential: string | null = credentialFor(sent)) {
  const method = (sent.method ?? 'GET').toUpperCase()
  const headers = new Headers(sent.extraHeaders)
  if (sent.cookie) headers.set('cookie', sent.cookie)
  if (sent.authorization) headers.set('authorization', sent.authorization)
  if (sent.contentType) headers.set('content-type', sent.contentType)
  headers.set('user-agent', 'vitest-api')
  if (credential !== null) headers.set('x-erp-internal', credential)
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return fetch(`${base}${sent.path}`, { method, headers, body: hasBody ? (sent.body ?? new Uint8Array(0)) : undefined, redirect: 'manual' })
}

export const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))
