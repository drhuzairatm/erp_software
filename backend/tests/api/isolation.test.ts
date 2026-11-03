/**
 * Stage 1: request-context isolation under concurrency (AsyncLocalStorage + pooled database connections).
 * 200 overlapping API requests from different staff (two companies, MD, CEO, system admin, managers, counsellors,
 * documentation), each with its own client address and company-scope cookie, through the REAL shared server code
 * (getSession, getScope, withUser) on a deliberately small pool (3 connections), while other transactions on the same
 * pool set different time zones. Each response must contain only its own user, address, scope and cookie; the database
 * settings app.user_id / app.request_ip / TimeZone must be the request's own, and must not survive the transaction.
 * The time zone is one value per process (APP_TIMEZONE); different time zones are simulated by the other transactions.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// a small pool forces connection reuse; an app time zone different from the server default (often the machine's own
// zone) lets the leak check tell them apart, and shows withUser applies APP_TIMEZONE
vi.hoisted(() => { process.env.DATABASE_POOL_SIZE = '3'; process.env.APP_TIMEZONE = 'Pacific/Auckland' })
// the shared server code runs with the Express request-context provider here (as in the API process)
vi.mock('@/lib/http/context-provider', async () => await import('../../src/lib/http/context-provider'))

import { getSession, login, SESSION_COOKIE } from '@/lib/auth/session'
import { db, withUser } from '@/lib/db'
import { requestClientIp, requestCookies } from '@/lib/http/request-context'
import { getScope, resolveScope } from '@/services/scope'
import { NoRequestContextError, type RequestStore, requestStore } from '../../src/lib/http/context-provider'
import { sendJson } from '../../src/lib/send'
import { adminSql, ctxFor, orgId } from '../support/helpers'
import { credentialFor, send, startApi } from './support'

const STAFF = ['edx.counsellor@demo.test', 'grd.counsellor@demo.test', 'edx.manager@demo.test', 'grd.manager@demo.test', 'docs@demo.test', 'md@demo.test', 'ceo@demo.test', 'admin@demo.test']
type Who = { email: string; userId: string; token: string; orgIds: string[] }
let api: Awaited<ReturnType<typeof startApi>>
let people: Who[] = []
let EDX: string; let GRD: string

/** Real password sign-in inside a request store; returns the session cookie value the API would have set. */
async function signIn(email: string): Promise<string> {
  const store: RequestStore = { headers: new Headers({ 'user-agent': 'vitest-isolation' }), cookies: new Map(), setCookies: [], ip: '192.0.2.1', origin: null, host: null }
  const r = await requestStore.run(store, () => login(email, process.env.SEED_DEMO_PASSWORD!))
  expect(r, email).toMatchObject({ ok: true, mfaPending: false })
  return store.cookies.get(SESSION_COOKIE)!
}

beforeAll(async () => {
  EDX = await orgId('EDX'); GRD = await orgId('GRD')
  people = await Promise.all(STAFF.map(async (email) => {
    const c = await ctxFor(email)
    return { email, userId: c.userId, token: await signIn(email), orgIds: c.memberships.map((m) => m.orgId) }
  }))
  api = await startApi({
    extraRoutes: (r) => {
      r.get('/__test/whoami', async (req, res) => {
        const s = await getSession()
        const scope = s ? await getScope(s) : null
        const sleep = Number(req.query.sleep ?? 0) / 1000
        const settings = s
          ? await withUser(s.userId, async (tx) => {
            await tx`select pg_sleep(${sleep})`
            const [x] = await tx<{ uid: string; ip: string; tz: string }[]>`
              select current_setting('app.user_id', true) as uid, current_setting('app.request_ip', true) as ip, current_setting('TimeZone') as tz`
            return x
          }, { ip: s.ip })
          : null
        ;(await requestCookies()).set('erp_echo', String(req.query.tag), { path: '/' })
        sendJson(res, 200, { user: s?.userId ?? null, orgs: s?.memberships.map((m) => m.orgId) ?? null, scope: scope?.orgIds ?? null, ip: await requestClientIp(), settings, tag: req.query.tag })
      })
      r.get('/__test/fail', async (req) => {
        const s = (await getSession())!
        await withUser(s.userId, async (tx) => {
          if (req.query.kind === 'sql') await tx`select 1 / 0`
          throw new Error('deliberate failure inside the transaction')
        }, { ip: s.ip })
      })
    },
  })
})
afterAll(async () => { await api.close(); await adminSql().end(); await db().end() })

describe('request-context isolation', () => {
  it('200 overlapping requests: every response and every database setting belongs to its own request; nothing leaks afterwards', async () => {
    const [{ reset_val: serverDefaultTz }] = await adminSql()`select reset_val from pg_settings where name = 'TimeZone'`
    const appTz = 'Pacific/Auckland'
    expect(serverDefaultTz).not.toBe(appTz) // otherwise the leak check could not tell them apart

    // other work on the SAME pool with different time zones: transaction-local, and one connection with a session-level
    // time zone that stays set while the batch runs
    const reserved = await db().reserve()
    await reserved`set TimeZone = 'America/New_York'`
    const noise = Array.from({ length: 30 }, (_, i) => db().begin(async (tx) => {
      const tz = i % 2 ? 'UTC' : 'America/New_York'
      await tx`select set_config('TimeZone', ${tz}, true), pg_sleep(${(i % 5) / 100})`
      const [x] = await tx<{ tz: string }[]>`select current_setting('TimeZone') as tz`
      expect(x.tz).toBe(tz)
    }))

    const scopes = () => [EDX, GRD, 'all', undefined][Math.floor(Math.random() * 4)]
    const requests = Array.from({ length: 200 }, (_, i) => {
      const who = people[i % people.length]
      const ip = `198.51.100.${(i % 250) + 1}`
      const scopeCookie = scopes()
      const cookie = `${SESSION_COOKIE}=${who.token}${scopeCookie ? `; erp_scope=${scopeCookie}` : ''}`
      return { i, who, ip, scopeCookie, cookie, path: `/__test/whoami?tag=t${i}&sleep=${Math.floor(Math.random() * 50)}` }
    }).sort(() => Math.random() - 0.5)

    // failing requests interleaved: an error thrown and an SQL error inside the transaction, and a body-digest refusal
    const failing = people.slice(0, 4).flatMap((w) => ['throw', 'sql'].map((kind) => send(api.base, { path: `/__test/fail?kind=${kind}`, cookie: `${SESSION_COOKIE}=${w.token}`, context: { ip: '192.0.2.99' } })))
    const digestRefusal = send(api.base, { method: 'POST', path: '/__test/whoami', body: new TextEncoder().encode('B') }, credentialFor({ method: 'POST', path: '/__test/whoami', body: new TextEncoder().encode('A') }))

    const results = await Promise.all(requests.map(async (q) => ({ q, res: await send(api.base, { path: q.path, cookie: q.cookie, context: { ip: q.ip } }) })))
    const failed = await Promise.all(failing)
    expect(failed.map((r) => r.status)).toEqual(Array(failed.length).fill(500))
    expect((await digestRefusal).status).toBe(404)
    await Promise.all(noise)

    for (const { q, res } of results) {
      expect(res.status).toBe(200)
      const b = await res.json()
      const label = `request ${q.i} (${q.who.email})`
      expect(b.user, label).toBe(q.who.userId)
      expect([...b.orgs].sort(), label).toEqual([...q.who.orgIds].sort())
      expect(b.ip, label).toBe(q.ip)
      expect(b.settings, label).toEqual({ uid: q.who.userId, ip: q.ip, tz: appTz })
      const expectedScope = resolveScope({ memberships: q.who.orgIds.map((orgId) => ({ orgId, orgName: '' })) as never }, q.scopeCookie).orgIds
      expect(b.scope, label).toEqual(expectedScope)
      expect(b.tag, label).toBe(`t${q.i}`)
      expect(res.headers.getSetCookie(), label).toEqual([`erp_echo=t${q.i}; Path=/`])
    }

    // nothing survives a transaction (normal end, thrown error, SQL error): plain queries on every pooled connection see
    // no user, no address and the server's default time zone
    await reserved`reset TimeZone`
    reserved.release()
    const after = await Promise.all(Array.from({ length: 12 }, () => db()<{ uid: string | null; ip: string | null; tz: string }[]>`
      select current_setting('app.user_id', true) as uid, current_setting('app.request_ip', true) as ip, current_setting('TimeZone') as tz, pg_sleep(0.01)`))
    for (const [x] of after) {
      expect(x.uid || null).toBeNull()
      expect(x.ip || null).toBeNull()
      expect(x.tz).toBe(serverDefaultTz)
    }
  })

  it('identity comes only from the session cookie: a user id in the query or headers is ignored', async () => {
    const res = await send(api.base, { path: `/__test/whoami?tag=x&userId=${people[0].userId}`, extraHeaders: { 'x-user-id': people[0].userId } })
    const b = await res.json()
    expect([b.user, b.settings]).toEqual([null, null])
  })

  it('outside an API request the shared code cannot read request data (throws)', async () => {
    await expect(requestCookies()).rejects.toBeInstanceOf(NoRequestContextError)
    await expect(requestClientIp()).rejects.toBeInstanceOf(NoRequestContextError)
  })
})
