/**
 * Stage 1: the internal API boundary. Real Express app in this process, throwaway test database.
 * Integrity (every signed part), one-time nonce (replay, concurrent duplicates, store full), time window, body digest
 * checked before any handler runs, size limits before reading, spoofed proxy headers ignored, no CORS, error mapping.
 */
import { request as httpRequest } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { invalid } from '@/lib/errors'
import { db } from '@/lib/db'
import { MAX_BODY_BYTES, signRequest } from '../../src/lib/http/internal-credential'
import { NoRequestContextError, provider as expressProvider, RedirectRequired, requestStore } from '../../src/lib/http/context-provider'
import { sendJson } from '../../src/lib/send'
import { credentialFor, ctx, json, partsOf, type Req, SECRET, send, startApi } from './support'

let api: Awaited<ReturnType<typeof startApi>>
let calls = 0
beforeAll(async () => {
  api = await startApi({
    extraRoutes: (r) => {
      r.post('/__test/count', (_req, res) => { calls++; sendJson(res, 200, { calls, bytes: (res.locals.erp.body as Buffer).length }) })
      r.get('/__test/context', async (_req, res) => {
        const s = requestStore.getStore()!
        sendJson(res, 200, { ip: await expressProvider.clientIp(), headers: [...s.headers], cookies: [...s.cookies], origin: s.origin, host: s.host })
      })
      r.get('/__test/service-error', () => { throw invalid('Please correct the highlighted fields.', { title: ['Enter a title.'] }) })
      r.get('/__test/redirect', () => { throw new RedirectRequired('/login') })
      r.get('/__test/crash', () => { throw new Error('internal detail that must not reach the client') })
    },
  })
})
afterAll(async () => { await api.close(); await db().end() })

const reasons = () => api.logs.map((l) => l.reason)
const lastReason = () => api.logs.at(-1)?.reason
const expectRefused = async (res: Response, status = 404) => {
  expect(res.status).toBe(status)
  expect(await res.text()).toBe('')
}

describe('health through the API', () => {
  it('signed GET /api/health: 200 {"status":"ok"}, application/json, no-store; nothing added by Express', async () => {
    const res = await send(api.base, { path: '/api/health' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"status":"ok"}')
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('cache-control')).toBe('no-store')
    for (const h of ['x-powered-by', 'etag', 'set-cookie']) expect(res.headers.get(h)).toBeNull()
    expect([...res.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([])
  })
})

describe('credential', () => {
  it('missing, malformed, wrong version, wrong secret: 404 with an empty body', async () => {
    const r: Req = { path: '/api/health' }
    await expectRefused(await send(api.base, r, null)); expect(lastReason()).toBe('missing')
    await expectRefused(await send(api.base, r, 'garbage')); expect(lastReason()).toBe('malformed')
    await expectRefused(await send(api.base, r, credentialFor(r).replace(/^v1\./, 'v2.'))); expect(lastReason()).toBe('version')
    const wrongSecret = signRequest('another-secret-that-is-at-least-32-chars-long', partsOf(r), ctx(), new Uint8Array(0))
    await expectRefused(await send(api.base, r, wrongSecret)); expect(lastReason()).toBe('signature')
  })

  it('every signed part is bound: changing cookie, authorization, body, query, path, method, content-type or length → 404, handler not run', async () => {
    const base: Req = { method: 'POST', path: '/__test/count?x=1', cookie: 'erp_session=a', authorization: 'Bearer a', contentType: 'application/json', body: json({ a: 1 }) }
    const before = calls
    const variants: Req[] = [
      { ...base, cookie: 'erp_session=b' },
      { ...base, cookie: undefined },
      { ...base, authorization: 'Bearer b' },
      { ...base, body: json({ a: 2 }) },              // same length, different bytes
      { ...base, body: json({ a: 10 }) },             // different length
      { ...base, path: '/__test/count?x=2' },
      { ...base, path: '/__test/count' },
      { ...base, method: 'PUT' },
      { ...base, contentType: 'text/plain' },
    ]
    for (const v of variants) await expectRefused(await send(api.base, v, credentialFor(base)))
    expect(calls).toBe(before)
    expect(reasons().slice(-variants.length)).toEqual(['signature', 'signature', 'signature', 'digest', 'signature', 'signature', 'signature', 'signature', 'signature'])
    // and the unmodified request works
    const ok = await send(api.base, base)
    expect(ok.status).toBe(200)
    expect(calls).toBe(before + 1)
  })

  it('time window: older than 60 s, more than 5 s in the future, or signed before the API started → 404', async () => {
    const r: Req = { path: '/api/health' }
    await expectRefused(await send(api.base, r, credentialFor(r, { now: Date.now() - 61_000 }))); expect(lastReason()).toBe('expired')
    await expectRefused(await send(api.base, r, credentialFor(r, { now: Date.now() + 6_000 }))); expect(lastReason()).toBe('future')
    await expectRefused(await send(api.base, r, credentialFor(r, { now: api.startedAt - 1 }))); expect(lastReason()).toBe('before_start')
    // inside the window and not before the start: accepted
    expect((await send(api.base, r, credentialFor(r, { now: Math.max(api.startedAt, Date.now() - 55_000) }))).status).toBe(200)
  })
})

describe('one-time nonce', () => {
  it('exact replay (same header, same body) → the second is refused', async () => {
    const r: Req = { method: 'POST', path: '/__test/count', contentType: 'application/json', body: json({ n: 1 }) }
    const cred = credentialFor(r)
    const before = calls
    expect((await send(api.base, r, cred)).status).toBe(200)
    await expectRefused(await send(api.base, r, cred)); expect(lastReason()).toBe('replay')
    expect(calls).toBe(before + 1)
  })

  it.each([2, 20])('%i concurrent identical requests → exactly one runs', async (n) => {
    const r: Req = { method: 'POST', path: '/__test/count', contentType: 'application/json', body: json({ n }) }
    const cred = credentialFor(r)
    const before = calls
    const statuses = (await Promise.all(Array.from({ length: n }, () => send(api.base, r, cred)))).map((x) => x.status)
    expect(statuses.filter((s) => s === 200)).toHaveLength(1)
    expect(statuses.filter((s) => s === 404)).toHaveLength(n - 1)
    expect(calls).toBe(before + 1)
  })

  it('body digest mismatch → refused before the handler; the nonce stays used (the correct body is refused afterwards too)', async () => {
    const good = json({ amount: 100 }); const bad = json({ amount: 999 })
    const r: Req = { method: 'POST', path: '/__test/count', contentType: 'application/json', body: good }
    const cred = credentialFor(r)
    const before = calls
    await expectRefused(await send(api.base, { ...r, body: bad }, cred)); expect(lastReason()).toBe('digest')
    await expectRefused(await send(api.base, r, cred)); expect(lastReason()).toBe('replay')
    expect(calls).toBe(before)
  })

  it('store full → 503 (fail closed, nothing evicted); requests are refused until entries expire', async () => {
    const small = await startApi({ replayMax: 3 })
    try {
      for (let i = 0; i < 3; i++) expect((await send(small.base, { path: '/api/health' })).status).toBe(200)
      await expectRefused(await send(small.base, { path: '/api/health' }), 503)
      expect(small.logs.at(-1)?.reason).toBe('replay_cache_full')
      expect(small.replay.size).toBe(3)
    } finally { await small.close() }
  })
})

describe('size and framing, checked before reading the body', () => {
  const raw = (headers: Record<string, string>, write?: Buffer) => new Promise<{ status: number; ms: number }>((resolve, reject) => {
    const started = Date.now()
    const u = new URL(api.base)
    const q = httpRequest({ host: u.hostname, port: u.port, method: 'POST', path: '/__test/count', headers }, (res) => { res.resume(); resolve({ status: res.statusCode!, ms: Date.now() - started }) })
    q.on('error', reject)
    q.flushHeaders() // send the headers now; the body is never completed
    if (write) q.write(write)
    // the body is never completed: a refusal must come without waiting for it
  })

  it('Content-Length over 11 MB → 413 immediately, nothing read, handler not run', async () => {
    const len = String(MAX_BODY_BYTES + 1)
    const parts = { ...partsOf({ method: 'POST', path: '/__test/count', contentType: 'application/octet-stream' }), contentLength: len }
    const cred = signRequest(SECRET, parts, ctx(), new Uint8Array(0))
    const before = calls
    const r = await raw({ 'content-type': 'application/octet-stream', 'content-length': len, 'x-erp-internal': cred })
    expect(r.status).toBe(413)
    expect(r.ms).toBeLessThan(2000)
    expect(calls).toBe(before)
  })

  it('chunked body (no Content-Length) → 411, handler not run', async () => {
    const parts = { ...partsOf({ method: 'POST', path: '/__test/count', contentType: 'application/octet-stream' }), contentLength: '0' }
    const cred = signRequest(SECRET, parts, ctx(), new Uint8Array(0))
    const before = calls
    const r = await raw({ 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked', 'x-erp-internal': cred }, Buffer.from('abc'))
    expect(r.status).toBe(411)
    expect(calls).toBe(before)
  })
})

describe('request context comes only from the signed credential', () => {
  it('spoofed X-Forwarded-For / X-Real-IP / Forwarded / user-agent headers are ignored; only allow-listed headers are readable', async () => {
    const res = await send(api.base, {
      path: '/__test/context', cookie: 'erp_scope=all',
      context: { ip: '198.51.100.7', userAgent: 'signed-agent', origin: 'https://erp.example', host: 'erp.example' },
      extraHeaders: { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7', forwarded: 'for=8.8.8.8', 'x-forwarded-host': 'evil.example', accept: 'text/html' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ip).toBe('198.51.100.7')
    expect(body.origin).toBe('https://erp.example')
    expect(body.host).toBe('erp.example')
    const h = Object.fromEntries(body.headers) as Record<string, string>
    expect(h['user-agent']).toBe('signed-agent')
    expect(h.accept).toBe('text/html')
    for (const k of Object.keys(h)) expect(['accept', 'accept-language', 'content-type', 'user-agent']).toContain(k)
    expect(body.cookies).toEqual([['erp_scope', 'all']])
  })

  it('reading the request context outside a request throws (no fallback)', async () => {
    await expect(expressProvider.cookies()).rejects.toBeInstanceOf(NoRequestContextError)
    await expect(expressProvider.clientIp()).rejects.toBeInstanceOf(NoRequestContextError)
    await expect(expressProvider.headers()).rejects.toBeInstanceOf(NoRequestContextError)
  })
})

describe('no CORS', () => {
  it('a browser preflight gets 404 and no Access-Control-* headers; a signed request with an Origin gets none either', async () => {
    const pre = await fetch(`${api.base}/api/health`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })
    expect(pre.status).toBe(404)
    expect([...pre.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([])
    const res = await send(api.base, { path: '/api/health', extraHeaders: { origin: 'https://evil.example' } })
    expect(res.status).toBe(200)
    expect([...res.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([])
  })
})

describe('error mapping', () => {
  it('ServiceError → its status with { message, fieldErrors }; redirect → 401 { reason, location }; anything else → 500 generic; unknown path → 404 empty', async () => {
    const se = await send(api.base, { path: '/__test/service-error' })
    expect(se.status).toBe(422)
    expect(await se.json()).toEqual({ message: 'Please correct the highlighted fields.', fieldErrors: { title: ['Enter a title.'] } })
    const rd = await send(api.base, { path: '/__test/redirect' })
    expect([rd.status, await rd.json()]).toEqual([401, { reason: 'redirect', location: '/login' }])
    const crash = await send(api.base, { path: '/__test/crash' })
    expect(crash.status).toBe(500)
    const text = await crash.text()
    expect(JSON.parse(text)).toEqual({ message: 'Something went wrong. Please try again.' })
    expect(text).not.toContain('internal detail')
    await expectRefused(await send(api.base, { path: '/no/such/path' }))
  })
})
