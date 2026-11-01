/**
 * M-1: staff sign-in and portal rate limits with forged, trusted and missing forwarding headers.
 * The real login() / requestCode() run against the test database; only the request headers and cookie jar are simulated.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let currentHeaders = new Headers()
const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  headers: async () => currentHeaders,
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => { jar.set(k, v) },
    delete: (k: string) => { jar.delete(k) },
  }),
}))

import { db } from '@/server/db'
import { login } from '@/server/auth/session'
import { acceptInvitation } from '@/server/auth/passwords'
import { requestCode } from '@/server/portal'
import * as admin from '@/server/services/admin'
import * as students from '@/server/services/students'
import { adminSql, ctxFor, orgId } from '../support/helpers'

const PW = 'Fictional-Lockout-6271!'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
let EDX: string
beforeAll(async () => { EDX = await orgId('EDX') })
afterEach(() => { delete process.env.TRUST_PROXY; currentHeaders = new Headers() })
afterAll(async () => { await adminSql().end(); await db().end() })

/** A fresh, fictional, active staff account (invited by the MD, invitation accepted). */
async function staff() {
  const md = await ctxFor('md@demo.test')
  const [role] = await adminSql()`select id from roles where org_id = ${EDX} and key = 'counsellor'`
  const email = `lockout.${rand()}@example.test`
  const r = await admin.createStaff(md, { email, fullName: `Lockout Test ${rand()}`, orgId: EDX, roleId: role.id })
  await acceptInvitation(r.setupPath!.split('/').pop()!, PW, PW)
  return email
}
const forgedHeaders = () => new Headers({ 'x-forwarded-for': `${1 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.9`, 'user-agent': 'vitest' })
const attemptIps = (email: string) => adminSql()`select ip from auth_private.login_attempts where email = ${email} order by id`

describe('staff sign-in lockout and client address (M-1)', () => {
  it('default (no trusted proxy): a forged X-Forwarded-For is ignored and never stored; the per-email lockout still applies after 5 failures', async () => {
    const email = await staff()
    for (let i = 0; i < 5; i++) {
      currentHeaders = forgedHeaders() // a new fake address every time
      expect(await login(email, 'wrong-password-123')).toMatchObject({ ok: false, message: 'Incorrect email or password.' })
    }
    currentHeaders = forgedHeaders()
    const blocked = await login(email, PW) // even the right password is refused during the lockout
    expect(blocked).toMatchObject({ ok: false })
    expect((blocked as { message: string }).message).toMatch(/Too many failed attempts/)
    expect((await attemptIps(email)).every((r) => r.ip === null)).toBe(true) // no fabricated address recorded
  })

  it('unknown address does NOT create one shared bucket: many failures from unknown addresses never lock out other users', async () => {
    const email = await staff()
    for (let i = 0; i < 32; i++) {
      currentHeaders = new Headers()
      await login(`nobody.${rand()}@example.test`, 'wrong-password-123')
    }
    currentHeaders = new Headers()
    expect(await login(email, PW)).toMatchObject({ ok: true })
  })

  it('trusted proxy (TRUST_PROXY=x-real-ip): the proxy-set address is recorded; the per-address limit (30 / 15 min) applies; forged X-Forwarded-For is ignored', async () => {
    process.env.TRUST_PROXY = 'x-real-ip'
    const victim = await staff()
    const attacker = `203.0.113.${Math.floor(Math.random() * 200) + 20}`
    for (let i = 0; i < 30; i++) {
      currentHeaders = new Headers({ 'x-real-ip': attacker, 'x-forwarded-for': `6.6.6.${i}` })
      await login(`spray.${rand()}@example.test`, 'wrong-password-123')
    }
    const [{ n }] = await adminSql()`select count(*)::int as n from auth_private.login_attempts where ip = ${attacker}`
    expect(n).toBe(30)
    expect((await adminSql()`select count(*)::int as n from auth_private.login_attempts where ip like '6.6.6.%'`)[0].n).toBe(0)
    currentHeaders = new Headers({ 'x-real-ip': attacker })
    expect((await login(victim, PW) as { message?: string }).message).toMatch(/Too many failed attempts/) // address blocked
    currentHeaders = new Headers({ 'x-real-ip': '198.51.100.23' })
    expect(await login(victim, PW)).toMatchObject({ ok: true }) // the same person from another address is fine
    expect((await attemptIps(victim)).map((r) => r.ip)).toContain('198.51.100.23')
  })
})

describe('student portal sign-in codes (M-1)', () => {
  it('per-identifier limit (5 per hour) still applies; forged forwarding headers are not stored', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const email = `portal.lock.${rand()}@example.test`
    const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Portal Lockout Student', phone: `+91 90052 ${rand().slice(0, 5)}`, email })
    if (!r.ok) throw new Error()
    for (let i = 0; i < 6; i++) { currentHeaders = forgedHeaders(); await requestCode(email) }
    const rows = await adminSql()`select code_hash, ip from auth_private.portal_challenges
      where identifier_hash = encode(sha256(convert_to(${email}, 'UTF8')), 'hex') order by created_at`
    expect(rows).toHaveLength(6)
    expect(rows.slice(0, 5).every((x) => x.code_hash !== 'rate-limited')).toBe(true)
    expect(rows[5].code_hash).toBe('rate-limited')
    expect(rows.every((x) => x.ip === null)).toBe(true)
  })
})
