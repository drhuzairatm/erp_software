import { describe, expect, it } from 'vitest'
import { REPLAY_TTL_MS, ReplayCache } from '../../src/lib/replay-cache'

const clock = (t = 1_000_000) => ({ t, now() { return this.t } })

describe('ReplayCache (one-time nonces)', () => {
  it('accepts a nonce once, refuses it again until it expires', () => {
    const c = clock(); const r = new ReplayCache(10, () => c.now())
    expect(r.reserve('a', c.t)).toBe('ok')
    expect(r.reserve('a', c.t)).toBe('duplicate')
    c.t += REPLAY_TTL_MS - 1
    expect(r.reserve('a', c.t)).toBe('duplicate')
    c.t += 1
    expect(r.reserve('a', c.t)).toBe('ok') // expired entry replaced (the time window refuses such old credentials anyway)
  })

  it('expiry is measured from the signature time, not the arrival time', () => {
    const c = clock(); const r = new ReplayCache(10, () => c.now())
    expect(r.reserve('a', c.t - 50_000)).toBe('ok')
    c.t += REPLAY_TTL_MS - 50_000
    r.sweep()
    expect(r.size).toBe(0)
  })

  it('sweep removes only expired entries', () => {
    const c = clock(); const r = new ReplayCache(10, () => c.now())
    r.reserve('old', c.t); c.t += 30_000; r.reserve('new', c.t)
    c.t += REPLAY_TTL_MS - 30_000
    r.sweep()
    expect(r.size).toBe(1)
    expect(r.reserve('new', c.t)).toBe('duplicate')
  })

  it('full of unexpired entries: fails closed and never evicts a live entry', () => {
    const c = clock(); const r = new ReplayCache(5, () => c.now())
    for (const n of ['a', 'b', 'c', 'd', 'e']) expect(r.reserve(n, c.t)).toBe('ok')
    expect(r.reserve('f', c.t)).toBe('full')
    expect(r.size).toBe(5)
    for (const n of ['a', 'b', 'c', 'd', 'e']) expect(r.reserve(n, c.t)).toBe('duplicate')
  })

  it('sweeps before inserting when over 90 % full, so expired entries free space', () => {
    const c = clock(); const r = new ReplayCache(10, () => c.now())
    for (let i = 0; i < 9; i++) r.reserve(`old${i}`, c.t)
    c.t += REPLAY_TTL_MS
    expect(r.reserve('x', c.t)).toBe('ok')
    expect(r.size).toBe(1)
  })

  it('stop() is safe without and after startSweeping()', () => {
    const r = new ReplayCache(10)
    r.stop(); r.startSweeping(1000); r.startSweeping(1000); r.stop(); r.stop()
  })
})
