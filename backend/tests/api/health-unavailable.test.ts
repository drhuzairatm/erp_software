import { afterAll, beforeAll, expect, it, vi } from 'vitest'

// the database is unreachable: every query fails (no real database is touched or stopped)
vi.mock('@/lib/db', () => ({ db: () => () => Promise.reject(new Error('connect ECONNREFUSED')) }))

import { send, startApi } from './support'

let api: Awaited<ReturnType<typeof startApi>>
beforeAll(async () => { api = await startApi() })
afterAll(async () => { await api.close() })

it('health with the database down: 503 {"status":"database_unavailable"}, application/json, no-store (same as the former route)', async () => {
  const res = await send(api.base, { path: '/api/health' })
  expect(res.status).toBe(503)
  expect(await res.text()).toBe('{"status":"database_unavailable"}')
  expect([res.headers.get('content-type'), res.headers.get('cache-control')]).toEqual(['application/json', 'no-store'])
})
