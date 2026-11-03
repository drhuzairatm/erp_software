import { createHmac, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  type RequestContextClaims, type SignedRequestParts, MAX_AGE_MS, FUTURE_SKEW_MS, canonicalString, signRequest, verifyCredential, bodyDigest, digestsEqual,
} from '@/lib/http/internal-credential'

const SECRET = 'unit-test-secret-not-real-0123456789abcdef'
const NOW = 1_800_000_000_000
const parts: SignedRequestParts = { method: 'POST', pathWithQuery: '/api/x?a=1&b=2', cookie: 'erp_session=abc', authorization: 'Bearer t', contentType: 'application/json', contentLength: '7' }
const context: RequestContextClaims = { ip: '203.0.113.5', userAgent: 'ua', origin: 'http://localhost:3000', host: 'localhost:3000' }
const body = new TextEncoder().encode('{"a":1}')
const sign = (o: { now?: number; nonce?: string } = {}) => signRequest(SECRET, parts, context, body, { now: NOW, ...o })

describe('internal credential', () => {
  it('round trip: verifies and returns the signed context, nonce, time and body digest', () => {
    const nonce = randomUUID()
    const r = verifyCredential(SECRET, sign({ nonce }), parts, { now: NOW })
    expect(r).toEqual({ ok: true, ts: NOW, nonce, context, claimedDigest: bodyDigest(body) })
  })

  it('a change to any signed part breaks the signature', () => {
    const changes: Partial<SignedRequestParts>[] = [
      { method: 'PUT' }, { pathWithQuery: '/api/x?a=1&b=3' }, { pathWithQuery: '/api/y?a=1&b=2' }, { cookie: 'erp_session=abd' },
      { cookie: '' }, { authorization: '' }, { authorization: 'Bearer u' }, { contentType: 'text/plain' }, { contentLength: '8' },
    ]
    const h = sign()
    for (const ch of changes) expect(verifyCredential(SECRET, h, { ...parts, ...ch }, { now: NOW }), JSON.stringify(ch)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyCredential(`${SECRET}x`, h, parts, { now: NOW })).toEqual({ ok: false, reason: 'signature' })
  })

  it('a changed field inside the header breaks the signature (ts, nonce, context, digest)', () => {
    const f = sign().split('.')
    const other = signRequest(SECRET, parts, { ...context, ip: '198.51.100.1' }, new Uint8Array([1]), { now: NOW + 1, nonce: randomUUID() }).split('.')
    for (const i of [1, 2, 3, 4]) {
      const g = [...f]; g[i] = other[i]
      expect(verifyCredential(SECRET, g.join('.'), parts, { now: NOW }), `field ${i}`).toEqual({ ok: false, reason: 'signature' })
    }
  })

  it('time window: 60 s old ok, older expired; 5 s ahead ok, more is future; before start refused', () => {
    expect(verifyCredential(SECRET, sign({ now: NOW - MAX_AGE_MS }), parts, { now: NOW }).ok).toBe(true)
    expect(verifyCredential(SECRET, sign({ now: NOW - MAX_AGE_MS - 1 }), parts, { now: NOW })).toEqual({ ok: false, reason: 'expired' })
    expect(verifyCredential(SECRET, sign({ now: NOW + FUTURE_SKEW_MS }), parts, { now: NOW }).ok).toBe(true)
    expect(verifyCredential(SECRET, sign({ now: NOW + FUTURE_SKEW_MS + 1 }), parts, { now: NOW })).toEqual({ ok: false, reason: 'future' })
    expect(verifyCredential(SECRET, sign({ now: NOW - 10 }), parts, { now: NOW, notBefore: NOW - 9 })).toEqual({ ok: false, reason: 'before_start' })
  })

  it('malformed input is refused and never throws', () => {
    const good = sign()
    const f = good.split('.')
    const bad = [undefined, '', '.', 'v1', good + '.x', f.slice(0, 5).join('.'), ['v2', ...f.slice(1)].join('.'),
      ['v1', 'abc', ...f.slice(2)].join('.'), ['v1', f[1], 'not-a-uuid', ...f.slice(3)].join('.'),
      [...f.slice(0, 3), 'a+b/', ...f.slice(4)].join('.'), [...f.slice(0, 3), 'x'.repeat(5000), ...f.slice(4)].join('.'),
      [...f.slice(0, 4), 'short', f[5]].join('.'), [...f.slice(0, 5), f[5] + 'A'].join('.'), '\u0000'.repeat(100), 'v1.' + '.'.repeat(4)]
    for (const h of bad) {
      const r = verifyCredential(SECRET, h, parts, { now: NOW })
      expect(r.ok, String(h).slice(0, 40)).toBe(false)
    }
  })

  it('a correctly signed context that is not JSON is refused as malformed; non-string fields become null', () => {
    const signRaw = (ctx: string) => {
      const nonce = randomUUID(); const digest = bodyDigest(body)
      const sig = createHmac('sha256', SECRET).update(canonicalString(NOW, nonce, ctx, digest, parts)).digest('base64url')
      return ['v1', String(NOW), nonce, ctx, digest, sig].join('.')
    }
    expect(verifyCredential(SECRET, signRaw(Buffer.from('not json').toString('base64url')), parts, { now: NOW })).toEqual({ ok: false, reason: 'malformed' })
    const odd = signRaw(Buffer.from(JSON.stringify({ ip: 5, userAgent: ['x'], origin: {}, host: 'h' })).toString('base64url'))
    expect(verifyCredential(SECRET, odd, parts, { now: NOW })).toMatchObject({ ok: true, context: { ip: null, userAgent: '', origin: null, host: 'h' } })
  })

  it('refuses to sign without a secret of at least 32 characters', () => {
    expect(() => signRequest('', parts, context, body)).toThrow(/INTERNAL_API_SECRET/)
    expect(() => signRequest('x'.repeat(31), parts, context, body)).toThrow(/INTERNAL_API_SECRET/)
  })

  it('pure: 1,000 interleaved signatures each verify only for their own request', async () => {
    const reqs = Array.from({ length: 1000 }, (_, i) => ({ p: { ...parts, pathWithQuery: `/api/x?i=${i}`, cookie: `c=${i}` }, c: { ...context, ip: `10.0.${i >> 8}.${i & 255}` } }))
    const signed = await Promise.all(reqs.map(async (r) => { await Promise.resolve(); return signRequest(SECRET, r.p, r.c, body, { now: NOW }) }))
    signed.forEach((h, i) => {
      expect(verifyCredential(SECRET, h, reqs[i].p, { now: NOW })).toMatchObject({ ok: true, context: reqs[i].c })
      expect(verifyCredential(SECRET, h, reqs[(i + 1) % 1000].p, { now: NOW }).ok).toBe(false)
    })
    expect(new Set(signed.map((h) => h.split('.')[2])).size).toBe(1000)
  })

  it('digestsEqual compares exactly', () => {
    const d = bodyDigest(body)
    expect(digestsEqual(d, d)).toBe(true)
    expect(digestsEqual(d, bodyDigest(new Uint8Array(0)))).toBe(false)
    expect(digestsEqual(d, d.slice(1))).toBe(false)
  })
})
