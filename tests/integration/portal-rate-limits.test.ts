/**
 * Finding N-1 (portal): password sign-in lockout by Student ID, sticky re-lock, parallel guessing and trusted browsers.
 * The real passwordLogin() / setPasswordWithLink() run against the throwaway test database. Fictional students only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': 'vitest' }),
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => { jar.set(k, v) },
    delete: (k: string | { name: string }) => { jar.delete(typeof k === 'string' ? k : k.name) },
  }),
}))

import { verifyPassword } from '@/server/auth/password'
import { hashToken } from '@/server/auth/tokens'
import { newDeviceToken, PORTAL_DEVICE_COOKIE } from '@/server/auth/trusted-device'
import { anonymous, db } from '@/server/db'
import { passwordLogin, setPasswordWithLink } from '@/server/portal'
import * as pa from '@/server/services/portal-accounts'
import * as students from '@/server/services/students'
import { adminSql, ctxFor, orgId } from '../support/helpers'

const PW = 'Fictional-Portal-N1-Pass7!'
const WRONG = 'Wrong-Password-123!'
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
let EDX: string
beforeAll(async () => { EDX = await orgId('EDX') })
afterEach(() => { jar = new Map() })
afterAll(async () => { await adminSql().end(); await db().end() })

const browser = () => new Map<string, string>()
const linkToken = (link: string) => new URL(link).searchParams.get('token')!

async function student() {
  const mgr = await ctxFor('edx.manager@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Portal N1 Student', phone: `+91 90093 ${rand()}`, email: `pn1.${rand()}@example.test` })
  if (!r.ok) throw new Error('duplicate')
  const [s] = await adminSql()`select student_code from students where id = ${r.id}`
  await setPasswordWithLink(linkToken((await pa.issuePortalLink(mgr, r.id)).link!), PW, PW)
  const [a] = await adminSql()`select id from auth_private.student_accounts where student_id = ${r.id}`
  return { mgr, id: r.id, code: s.student_code as string, account: a.id as string }
}
const signIn = async (b: Map<string, string>, id: string, pw: string) => { jar = b; return passwordLogin(id, pw) }
const portalDeviceValid = async (b: Map<string, string>, account: string) => {
  const t = b.get(PORTAL_DEVICE_COOKIE); if (!t) return false
  const [r] = await adminSql()`select app.portal_device_valid(${hashToken(t)}, ${account}) as d`
  return r.d !== null
}

describe('N-1 portal: knowing a Student ID is not enough to lock the student out', () => {
  it('5 wrong passwords from other browsers lock unrecognised browsers; the student\'s usual (trusted) browser still signs in', async () => {
    const s = await student()
    const usual = browser()
    expect(await signIn(usual, s.code, PW)).toBe(true)
    expect(usual.get(PORTAL_DEVICE_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    for (let i = 0; i < 5; i++) expect(await signIn(browser(), s.code, WRONG)).toBe(false)
    expect(await signIn(browser(), s.code, PW)).toBe(false) // unrecognised browser: locked even with the right password
    expect((await pa.portalAccount(s.mgr, s.id)).account?.locked).toBe(true)
    expect(await signIn(usual, s.code, PW)).toBe(true)
    const rows = await adminSql()`select token_hash from auth_private.trusted_devices where account_id = ${s.account}`
    expect(rows.map((r) => r.token_hash)).toContain(hashToken(usual.get(PORTAL_DEVICE_COOKIE)!)) // only the hash is stored
  })

  it('a trusted browser has its own limit (10); a cookie of another student gives nothing', async () => {
    const a = await student(); const b = await student()
    const aBrowser = browser(); expect(await signIn(aBrowser, a.code, PW)).toBe(true)
    expect(await portalDeviceValid(aBrowser, b.account)).toBe(false)
    for (let i = 0; i < 10; i++) expect(await signIn(aBrowser, a.code, WRONG)).toBe(false)
    expect(await signIn(aBrowser, a.code, PW)).toBe(false)
    expect(await signIn(browser(), a.code, PW)).toBe(true) // unrecognised browsers: own counter, untouched
  })

  it('sticky re-lock fixed: after the 15 minutes, ONE wrong password does not lock again', async () => {
    const s = await student()
    for (let i = 0; i < 5; i++) await signIn(browser(), s.code, WRONG)
    expect(await signIn(browser(), s.code, PW)).toBe(false)
    await adminSql()`update auth_private.student_accounts set locked_until = now() - interval '1 second' where id = ${s.account}`
    expect(await signIn(browser(), s.code, WRONG)).toBe(false)
    expect(await signIn(browser(), s.code, PW)).toBe(true)
  })

  it('the legacy outcome function has the same fix (attempts while locked do not extend; an expired lock starts afresh)', async () => {
    const s = await student()
    const legacy = async (pw: string) => {
      const c = await anonymous((tx) => tx<{ account_id: string; password_hash: string | null }[]>`select * from app.portal_password_candidates(${s.code})`)
      const ok: string[] = []; const failed: string[] = []
      for (const x of c) (x.password_hash && await verifyPassword(x.password_hash, pw) ? ok : failed).push(x.account_id)
      const [r] = await anonymous((tx) => tx<{ ok: boolean }[]>`select app.portal_password_result(${s.code}, ${ok}::uuid[], ${failed}::uuid[], ${'t-' + rand() + Date.now()}, '127.0.0.1', 'test') as ok`)
      return r.ok
    }
    for (let i = 0; i < 5; i++) await legacy(WRONG)
    const [l1] = await adminSql()`select locked_until from auth_private.student_accounts where id = ${s.account}`
    await legacy(PW) // while locked: refused, does not extend
    const [l2] = await adminSql()`select locked_until, failed_attempts from auth_private.student_accounts where id = ${s.account}`
    expect(l2.locked_until.getTime()).toBe(l1.locked_until.getTime())
    await adminSql()`update auth_private.student_accounts set locked_until = now() - interval '1 second' where id = ${s.account}`
    await legacy(WRONG)
    const [l3] = await adminSql()`select locked_until, failed_attempts from auth_private.student_accounts where id = ${s.account}`
    expect(l3).toEqual({ locked_until: null, failed_attempts: 1 })
    expect(await legacy(PW)).toBe(true)
  })

  it('20 parallel wrong passwords: exactly 5 counted, then locked (no parallel guessing beyond the limit)', async () => {
    const s = await student()
    jar = browser()
    const r = await Promise.all(Array.from({ length: 20 }, () => passwordLogin(s.code, WRONG)))
    expect(r.every((x) => x === false)).toBe(true)
    const [a] = await adminSql()`select failed_attempts, locked_until from auth_private.student_accounts where id = ${s.account}`
    expect(a.failed_attempts).toBe(5)
    expect(a.locked_until).not.toBeNull()
    expect(await signIn(browser(), s.code, PW)).toBe(false)
  })

  it('revocation: disabling the account or a new password ends trusted browsers; the browser that set the new password is trusted (recovery)', async () => {
    const s = await student()
    const usual = browser(); expect(await signIn(usual, s.code, PW)).toBe(true)
    expect(await portalDeviceValid(usual, s.account)).toBe(true)
    for (let i = 0; i < 5; i++) await signIn(browser(), s.code, WRONG) // locked for unrecognised browsers
    const recovery = browser(); const device = newDeviceToken()
    await setPasswordWithLink(linkToken((await pa.issuePortalLink(s.mgr, s.id)).link!), PW + 'x', PW + 'x', device.hash)
    recovery.set(PORTAL_DEVICE_COOKIE, device.token) // what the set-password action does
    expect(await portalDeviceValid(usual, s.account)).toBe(false) // new password → old trusted browsers revoked
    expect(await portalDeviceValid(recovery, s.account)).toBe(true)
    expect(await signIn(recovery, s.code, PW + 'x')).toBe(true)
    expect(await signIn(browser(), s.code, PW + 'x')).toBe(true) // the reset also cleared the unrecognised-browser count
    await pa.setPortalAccountEnabled(s.mgr, s.id, false, 'Left the programme (fictional N-1 test)')
    expect(await portalDeviceValid(recovery, s.account)).toBe(false)
    expect(await signIn(recovery, s.code, PW + 'x')).toBe(false)
  })
})
