import { networkInterfaces } from 'node:os'
import { connect } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiConfig } from '../../src/lib/api-config'
import { startApi } from './support'

const SECRET = 'x'.repeat(32)

describe('API start-up configuration (refuses unsafe settings)', () => {
  it('defaults: loopback 127.0.0.1:4000 with a 32+ character secret', () => {
    expect(apiConfig({ INTERNAL_API_SECRET: SECRET })).toEqual({ host: '127.0.0.1', port: 4000, secret: SECRET })
    expect(apiConfig({ INTERNAL_API_SECRET: SECRET, API_HOST: '::1', API_PORT: '4100', API_INSTANCES: '1' })).toMatchObject({ host: '::1', port: 4100 })
    expect(apiConfig({ INTERNAL_API_SECRET: SECRET, API_HOST: 'localhost' }).host).toBe('localhost')
  })

  it.each([
    ['no secret', {}, /INTERNAL_API_SECRET/],
    ['short secret', { INTERNAL_API_SECRET: 'x'.repeat(31) }, /INTERNAL_API_SECRET/],
    ['all interfaces', { INTERNAL_API_SECRET: SECRET, API_HOST: '0.0.0.0' }, /API_HOST/],
    ['IPv6 any', { INTERNAL_API_SECRET: SECRET, API_HOST: '::' }, /API_HOST/],
    ['LAN address', { INTERNAL_API_SECRET: SECRET, API_HOST: '192.168.1.10' }, /API_HOST/],
    ['bad port', { INTERNAL_API_SECRET: SECRET, API_PORT: 'abc' }, /API_PORT/],
    ['port out of range', { INTERNAL_API_SECRET: SECRET, API_PORT: '70000' }, /API_PORT/],
    ['several instances', { INTERNAL_API_SECRET: SECRET, API_INSTANCES: '2' }, /API_INSTANCES/],
  ] as const)('refuses: %s', (_, env, msg) => {
    expect(() => apiConfig(env as Record<string, string>)).toThrow(/^Refusing to start the API/)
    expect(() => apiConfig(env as Record<string, string>)).toThrow(msg)
  })

  it('refuses to run as a cluster worker', () => {
    expect(() => apiConfig({ INTERNAL_API_SECRET: SECRET }, true)).toThrow(/cluster worker/)
  })

  it('the error never contains the secret value', () => {
    try { apiConfig({ INTERNAL_API_SECRET: 'secret-value-too-short' }) } catch (e) { expect(String(e)).not.toContain('secret-value-too-short') }
  })
})

describe('loopback binding', () => {
  let api: Awaited<ReturnType<typeof startApi>>
  beforeAll(async () => { api = await startApi() })
  afterAll(async () => { await api.close() })

  const port = () => Number(new URL(api.base).port)
  const tryConnect = (host: string) => new Promise<'connected' | 'refused'>((resolve) => {
    const s = connect({ host, port: port(), timeout: 2000 })
    s.once('connect', () => { s.destroy(); resolve('connected') })
    s.once('error', () => resolve('refused'))
    s.once('timeout', () => { s.destroy(); resolve('refused') })
  })

  it('is reachable on 127.0.0.1', async () => {
    expect(await tryConnect('127.0.0.1')).toBe('connected')
  })

  const external = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address
  it.skipIf(!external)('is NOT reachable on this machine\'s network address', async () => {
    expect(await tryConnect(external!)).toBe('refused')
  })
})
