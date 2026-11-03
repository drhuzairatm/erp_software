/**
 * Stage 1: the Next.js side of the internal API boundary (src/server-api/forward.ts, proxy.ts).
 * A local capture server records exactly what the Next.js server sends (headers, body) and answers with chosen responses;
 * the real Express API (in-process) is used for the end-to-end health and refusal cases.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { GET as healthRoute } from '@/app/api/health/route'
import { SESSION_COOKIE } from '@/lib/auth/session'
import { PORTAL_DEVICE_COOKIE, STAFF_DEVICE_COOKIE } from '@/lib/auth/trusted-device'
import { bodyDigest, INTERNAL_HEADER, verifyCredential } from '@/lib/http/internal-credential'
import { PORTAL_COOKIE } from '@/services/portal'
import { SCOPE_COOKIE } from '@/services/scope'
import { ApiUnavailableError, apiPathSegment, filterCookieHeader, FORWARDED_COOKIES, forwardToApi } from '@/server-api/forward'
import { proxyToApi } from '@/server-api/proxy'
import { startTestApi } from './support/api'

type Captured = { method: string; url: string; headers: IncomingHttpHeaders; rawHeaders: string[]; body: Buffer }
let captured: Captured[] = []
let reply: (res: import('node:http').ServerResponse) => void = (res) => { res.statusCode = 204; res.end() }
let capture: Server
let CAPTURE_URL: string

beforeAll(async () => {
  capture = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => { captured.push({ method: req.method!, url: req.url!, headers: req.headers, rawHeaders: req.rawHeaders, body: Buffer.concat(chunks) }); reply(res) })
  })
  await new Promise<void>((resolve) => capture.listen(0, '127.0.0.1', () => resolve()))
  CAPTURE_URL = `http://127.0.0.1:${(capture.address() as AddressInfo).port}`
})
afterAll(async () => { capture.closeAllConnections(); await new Promise((r) => capture.close(r)) })
afterEach(() => { captured = []; vi.unstubAllEnvs(); reply = (res) => { res.statusCode = 204; res.end() } })

const toCapture = () => vi.stubEnv('API_INTERNAL_URL', CAPTURE_URL)
const browser = (h: Record<string, string>) => new Headers(h)
/** The credential context the API would see, after checking the signature against what was actually received. */
function verified(c: Captured) {
  const ct = c.headers['content-type'] ?? ''
  const r = verifyCredential(process.env.INTERNAL_API_SECRET!, c.headers[INTERNAL_HEADER] as string, {
    method: c.method, pathWithQuery: c.url, cookie: c.headers.cookie ?? '', authorization: c.headers.authorization ?? '',
    contentType: ct, contentLength: c.headers['content-length'] ?? '0',
  })
  if (!r.ok) throw new Error(`credential refused: ${r.reason}`)
  return r
}

describe('what the Next.js server sends to the API', () => {
  it('only the ERP cookies, first occurrence each, in a fixed order; values unchanged', async () => {
    expect(FORWARDED_COOKIES).toEqual([SESSION_COOKIE, STAFF_DEVICE_COOKIE, PORTAL_COOKIE, PORTAL_DEVICE_COOKIE, SCOPE_COOKIE])
    const raw = `_ga=1; ${SCOPE_COOKIE}=all; leadist_session=zzz; ${SESSION_COOKIE}=tok%3Dx; ${SESSION_COOKIE}=second; ${PORTAL_COOKIE}=p; ${STAFF_DEVICE_COOKIE}=d; tracking=1`
    expect(filterCookieHeader(raw)).toBe(`${SESSION_COOKIE}=tok%3Dx; ${STAFF_DEVICE_COOKIE}=d; ${PORTAL_COOKIE}=p; ${SCOPE_COOKIE}=all`)
    expect(filterCookieHeader('_ga=1; other=2')).toBe('')
    expect(filterCookieHeader(null)).toBe('')

    toCapture()
    await forwardToApi({ method: 'GET', path: '/api/x', incoming: browser({ cookie: raw }) })
    expect(captured[0].headers.cookie).toBe(`${SESSION_COOKIE}=tok%3Dx; ${STAFF_DEVICE_COOKIE}=d; ${PORTAL_COOKIE}=p; ${SCOPE_COOKIE}=all`)
    await forwardToApi({ method: 'GET', path: '/api/x', incoming: browser({ cookie: '_ga=1' }) })
    expect(captured[1].headers.cookie).toBeUndefined()
  })

  it('a new header set: only User-Agent, Accept, Accept-Language (+ the credential); proxy, host and spoofed headers are never copied', async () => {
    toCapture()
    await forwardToApi({ method: 'GET', path: '/api/x', incoming: browser({
      'user-agent': 'Browser/1', accept: 'text/html', 'accept-language': 'en-IN', 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4',
      forwarded: 'for=1.2.3.4', 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'http', [INTERNAL_HEADER]: 'v1.spoofed',
      authorization: 'Bearer browser', origin: 'http://evil.test', referer: 'http://evil.test/', 'x-user-id': 'someone', 'content-type': 'text/plain',
    }) })
    const h = captured[0].headers
    const names = Object.keys(h).filter((n) => !['host', 'connection', 'accept-encoding', 'sec-fetch-mode'].includes(n)).sort()
    expect(names).toEqual(['accept', 'accept-language', 'user-agent', INTERNAL_HEADER].sort())
    expect([h['user-agent'], h.accept, h['accept-language']]).toEqual(['Browser/1', 'text/html', 'en-IN'])
    expect(h[INTERNAL_HEADER]).not.toBe('v1.spoofed')
    expect(h.host).toBe(new URL(CAPTURE_URL).host) // fetch's own Host for the API address, not the browser's
    verified(captured[0])
  })

  it('Authorization only when passed explicitly (proxyToApi forwardAuthorization), and then signed', async () => {
    toCapture()
    const r = () => new Request('http://localhost/api/cron/x', { headers: { authorization: 'Bearer cron-test' } })
    await proxyToApi(r(), '/api/cron/x')
    await proxyToApi(r(), '/api/cron/x', { forwardAuthorization: true })
    expect(captured[0].headers.authorization).toBeUndefined()
    expect(captured[1].headers.authorization).toBe('Bearer cron-test')
    verified(captured[1])
    // the signature covers it: the same credential with a different Authorization is refused
    const c = { ...captured[1], headers: { ...captured[1].headers, authorization: 'Bearer other' } }
    expect(() => verified(c)).toThrow(/signature/)
  })

  it('the query string is passed on unchanged (and signed)', async () => {
    toCapture()
    await proxyToApi(new Request('http://localhost/api/reports/x?from=2026-01-01&to=2026-02-01&q=a%20b&q=c'), '/api/reports/x')
    expect(captured[0].url).toBe('/api/reports/x?from=2026-01-01&to=2026-02-01&q=a%20b&q=c')
    verified(captured[0])
  })

  it('client address: unknown without a trusted proxy; X-Real-IP only with TRUST_PROXY=x-real-ip; host prefers X-Forwarded-Host', async () => {
    toCapture()
    const incoming = browser({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.1', host: 'localhost:3000', 'x-forwarded-host': 'erp.example.test', origin: 'https://erp.example.test', 'user-agent': 'UA' })
    vi.stubEnv('TRUST_PROXY', '')
    await forwardToApi({ method: 'GET', path: '/api/x', incoming })
    expect(verified(captured[0]).context).toEqual({ ip: null, userAgent: 'UA', origin: 'https://erp.example.test', host: 'erp.example.test' })
    vi.stubEnv('TRUST_PROXY', 'x-real-ip')
    await forwardToApi({ method: 'GET', path: '/api/x', incoming })
    expect(verified(captured[1]).context.ip).toBe('198.51.100.7')
    await forwardToApi({ method: 'GET', path: '/api/x', incoming: browser({ host: 'localhost:3000' }) })
    expect(verified(captured[2]).context).toEqual({ ip: null, userAgent: '', origin: null, host: 'localhost:3000' })
  })

  it('POST: the exact body bytes, its Content-Type and Content-Length, and the matching body digest', async () => {
    toCapture()
    const bytes = new Uint8Array([0, 1, 2, 255, 10, 13])
    await proxyToApi(new Request('http://localhost/api/students/x/merge', { method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream' } }), '/api/students/x/merge')
    const c = captured[0]
    expect([c.method, [...c.body], c.headers['content-type'], c.headers['content-length']]).toEqual(['POST', [...bytes], 'application/octet-stream', '6'])
    expect(verified(c).claimedDigest).toBe(bodyDigest(bytes))
  })

  it('route parameters become exactly one path segment (no traversal, no dot segments)', async () => {
    toCapture()
    for (const [id, sent] of [['abc', '/api/files/abc'], ['a/b', '/api/files/a%2Fb'], ['..', '/api/files/...'], ['.', '/api/files/...'], ['...', '/api/files/...'],
      ['%2e%2e', '/api/files/%252e%252e'], ['a?b=1#c', '/api/files/a%3Fb%3D1%23c'], ['ü', '/api/files/%C3%BC']] as const) {
      captured = []
      await forwardToApi({ method: 'GET', path: `/api/files/${apiPathSegment(id)}`, incoming: browser({}) })
      expect(captured[0].url, id).toBe(sent)
    }
  })

  it('every request gets a fresh one-time credential', async () => {
    toCapture()
    await forwardToApi({ method: 'GET', path: '/api/x', incoming: browser({}) })
    await forwardToApi({ method: 'GET', path: '/api/x', incoming: browser({}) })
    expect(verified(captured[0]).nonce).not.toBe(verified(captured[1]).nonce)
  })
})

describe('what the browser gets back (proxyToApi)', () => {
  it('status, only the allow-listed headers, every Set-Cookie, and the body', async () => {
    toCapture()
    reply = (res) => {
      res.statusCode = 201
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="x.csv"')
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Set-Cookie', ['a=1; Path=/; HttpOnly', 'b=2; Path=/; Max-Age=0'])
      res.setHeader('X-Powered-By', 'Express')
      res.setHeader('Server', 'internal')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader(INTERNAL_HEADER, 'should-not-leak')
      res.end('a,b\n1,2\n')
    }
    const res = await proxyToApi(new Request('http://localhost/api/x'), '/api/x')
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('a,b\n1,2\n')
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/; Max-Age=0'])
    const names = [...new Set(res.headers.keys())].sort() // keys() lists set-cookie once per cookie
    expect(names).toEqual(['cache-control', 'content-disposition', 'content-length', 'content-type', 'set-cookie', 'x-content-type-options'])
  })

  it('a redirect from the API is relayed to the browser, not followed', async () => {
    toCapture()
    reply = (res) => { res.statusCode = 302; res.setHeader('Location', '/login'); res.end() }
    const res = await proxyToApi(new Request('http://localhost/api/x'), '/api/x')
    expect([res.status, res.headers.get('location')]).toEqual([302, '/login'])
    expect(captured).toHaveLength(1)
  })
})

describe('end to end with the real Express API', () => {
  let api: Awaited<ReturnType<typeof startTestApi>>
  beforeAll(async () => { api = await startTestApi() })
  afterAll(async () => { await api.close() })

  it('health: 200 {"status":"ok"}, application/json, no-store; nothing else relayed', async () => {
    const res = await healthRoute(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"status":"ok"}')
    expect(Object.fromEntries(res.headers)).toEqual({ 'cache-control': 'no-store', 'content-type': 'application/json', 'content-length': '15' })
  })

  it('a request straight to the API without the Next.js server (no credential) gets an empty 404', async () => {
    const res = await fetch(`${api.base}/api/health`)
    expect([res.status, await res.text()]).toEqual([404, ''])
  })

  it('unknown API path through the proxy: 404 relayed', async () => {
    const res = await proxyToApi(new Request('http://localhost/api/nothing'), '/api/nothing')
    expect(res.status).toBe(404)
  })
})

describe('API unavailable', () => {
  it('not running: health 503 {"status":"api_unavailable"} no-store; other proxied routes 502 empty no-store', async () => {
    const closed = createServer()
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()))
    const port = (closed.address() as AddressInfo).port
    await new Promise((r) => closed.close(r))
    vi.stubEnv('API_INTERNAL_URL', `http://127.0.0.1:${port}`)

    const h = await healthRoute(new Request('http://localhost/api/health'))
    expect([h.status, await h.json(), h.headers.get('cache-control')]).toEqual([503, { status: 'api_unavailable' }, 'no-store'])
    const p = await proxyToApi(new Request('http://localhost/api/x'), '/api/x')
    expect([p.status, await p.text(), p.headers.get('cache-control')]).toEqual([502, '', 'no-store'])
    await expect(forwardToApi({ method: 'GET', path: '/api/x', incoming: browser({}) })).rejects.toMatchObject({ reason: 'unreachable' })
  })

  it('secret not configured: refused before any request is sent (health 503)', async () => {
    toCapture()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('INTERNAL_API_SECRET', '')
    await expect(forwardToApi({ method: 'GET', path: '/api/x', incoming: browser({}) })).rejects.toBeInstanceOf(ApiUnavailableError)
    vi.stubEnv('INTERNAL_API_SECRET', 'too-short')
    const h = await healthRoute(new Request('http://localhost/api/health'))
    expect(h.status).toBe(503)
    expect(captured).toHaveLength(0)
    for (const [line] of errors.mock.calls) expect(String(line)).not.toContain('too-short')
    errors.mockRestore()
  })
})
