/**
 * Contract of the students module's existing HTTP endpoint GET /api/students/import-template, recorded against the
 * former route handler BEFORE it was moved to the Express API and required to stay identical afterwards (then: Next.js
 * route → signed BFF call → Express students.routes → authenticate → students.controller → services/student-import).
 * (POST /api/students/[id]/merge is not part of this slice; see contract-route-handlers.test.ts.)
 * Uses only the throwaway test database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': 'vitest-contract' }),
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (k: string) => jar.has(k),
    set: (k: string | { name: string; value: string }, v?: string) => { if (typeof k === 'string') jar.set(k, v!); else jar.set(k.name, k.value) },
    delete: (k: string | { name: string }) => { jar.delete(typeof k === 'string' ? k : k.name) },
  }),
}))

import { GET } from '@/app/api/students/import-template/route'
import { login } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { importTemplateCsv } from '@/services/student-import'
import { adminSql } from '../../../backend/tests/support/helpers'
import { startApiProcess } from './support/api-process'

// the former handler took no arguments (it read next/headers); the proxied handler takes the browser request
const route = GET
const STAFF = ['docs@demo.test', 'edx.manager@demo.test', 'edx.counsellor@demo.test', 'grd.manager@demo.test', 'grd.counsellor@demo.test', 'md@demo.test', 'ceo@demo.test', 'admin@demo.test']
const browserRequest = (url = '/api/students/import-template') => {
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  return new Request(`http://localhost${url}`, { headers: cookie ? { cookie } : {} })
}
async function signIn(email: string) {
  jar = new Map()
  expect(await login(email, process.env.SEED_DEMO_PASSWORD!), email).toMatchObject({ ok: true, mfaPending: false })
}
const allHeaders = (res: Response) => Object.fromEntries([...res.headers].filter(([k]) => k !== 'content-length').sort(([a], [b]) => a.localeCompare(b)))
const TEMPLATE_HEADERS = { 'cache-control': 'no-store', 'content-disposition': 'attachment; filename="student-import-template.csv"', 'content-type': 'text/csv; charset=utf-8' }

let api: Awaited<ReturnType<typeof startApiProcess>>
beforeAll(async () => { api = await startApiProcess() })
afterAll(async () => { await api.close(); await adminSql().end(); await db().end() })

describe('GET /api/students/import-template', () => {
  it('signed out: 404 "Not found", text/plain, no cache header', async () => {
    jar = new Map()
    const res = await route(browserRequest())
    expect([res.status, await res.text(), allHeaders(res)]).toEqual([404, 'Not found', { 'content-type': 'text/plain;charset=UTF-8' }])
  })

  it('signed in: 200, exactly the template bytes (UTF-8 BOM first) and exactly the attachment headers; query string ignored', async () => {
    await signIn('edx.counsellor@demo.test')
    for (const url of ['/api/students/import-template', '/api/students/import-template?format=xlsx&x=1']) {
      const res = await route(browserRequest(url))
      expect(res.status, url).toBe(200)
      expect(allHeaders(res), url).toEqual(TEMPLATE_HEADERS)
      const bytes = new Uint8Array(await res.arrayBuffer())
      expect(bytes, url).toEqual(new TextEncoder().encode(importTemplateCsv()))
      expect([bytes[0], bytes[1], bytes[2]], url).toEqual([0xef, 0xbb, 0xbf])
    }
  })

  it('account matrix: any fully set-up staff session gets it (no permission check); MFA-gated sessions get 404', async () => {
    const m: Record<string, number> = {}
    for (const email of STAFF) {
      await signIn(email)
      const res = await route(browserRequest())
      m[email] = res.status; await res.arrayBuffer()
    }
    expect(m).toMatchInlineSnapshot(`
      {
        "admin@demo.test": 404,
        "ceo@demo.test": 404,
        "docs@demo.test": 200,
        "edx.counsellor@demo.test": 200,
        "edx.manager@demo.test": 200,
        "grd.counsellor@demo.test": 200,
        "grd.manager@demo.test": 200,
        "md@demo.test": 404,
      }
    `)
  })
})

describe('internal API unavailable (decision D6)', () => {
  it('502, empty, no-store (proves the requests above went through the API process)', async () => {
    await signIn('edx.counsellor@demo.test')
    await api.close()
    process.env.API_INTERNAL_URL = api.base
    try {
      const res = await route(browserRequest())
      expect([res.status, await res.text(), allHeaders(res)]).toEqual([502, '', { 'cache-control': 'no-store' }])
    } finally { delete process.env.API_INTERNAL_URL }
  })
})
