/** M-1: client address resolution only believes the header set by the configured trusted proxy. */
import { describe, expect, it } from 'vitest'
import { resolveClientIp, trustProxyMode } from '@/lib/client-ip'

const h = (o: Record<string, string>) => new Headers(o)
const forged = { 'x-forwarded-for': '6.6.6.6, 7.7.7.7', 'x-real-ip': '8.8.8.8' }

describe('trusted-proxy client address', () => {
  it('default (no TRUST_PROXY / direct access): every forwarding header is ignored – address unknown', () => {
    expect(trustProxyMode(undefined)).toBe('none')
    expect(trustProxyMode('something-else')).toBe('none')
    expect(resolveClientIp(h(forged), 'none')).toBeNull()
    expect(resolveClientIp(h({ 'x-forwarded-for': '1.2.3.4' }), 'none')).toBeNull()
  })

  it('x-real-ip (Hostinger VPS): only X-Real-IP set by the proxy is used; a forged X-Forwarded-For is ignored', () => {
    expect(trustProxyMode('X-Real-IP')).toBe('x-real-ip')
    expect(resolveClientIp(h({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '203.0.113.9' }), 'x-real-ip')).toBe('203.0.113.9')
    expect(resolveClientIp(h({ 'x-forwarded-for': '6.6.6.6' }), 'x-real-ip')).toBeNull() // proxy header missing → unknown
    expect(resolveClientIp(h({ 'x-real-ip': '2001:db8::1' }), 'x-real-ip')).toBe('2001:db8::1')
  })

  it('xff-last: the right-most entry (appended by the trusted proxy) is used, never the client-supplied left part', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' }), 'xff-last', 1)).toBe('198.51.100.7')
    expect(resolveClientIp(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 10.0.0.2' }), 'xff-last', 2)).toBe('198.51.100.7')
    expect(resolveClientIp(h({ 'x-forwarded-for': '198.51.100.7' }), 'xff-last', 2)).toBeNull() // fewer hops than configured
  })

  it('vercel: X-Real-IP set by the platform', () => {
    expect(resolveClientIp(h({ 'x-real-ip': '192.0.2.44', 'x-forwarded-for': '6.6.6.6' }), 'vercel')).toBe('192.0.2.44')
  })

  it('garbage or oversized values are never accepted as an address', () => {
    for (const bad of ['not-an-ip', "1.2.3.4'; drop table x", '999.1.1.1', '1.2.3.4:8080', 'a'.repeat(100), '']) {
      expect(resolveClientIp(h({ 'x-real-ip': bad }), 'x-real-ip')).toBeNull()
      expect(resolveClientIp(h({ 'x-forwarded-for': bad }), 'xff-last')).toBeNull()
    }
  })
})
