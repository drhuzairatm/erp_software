/**
 * Finding N-1: staff sign-in lockout and password-reset abuse.
 * The real login() / requestPasswordReset() / completePasswordReset() / two-step step run against the throwaway test
 * database; only request headers and each simulated browser's cookie jar are simulated. Fictional accounts only.
 * Reset links are read from the encrypted queue only to complete the flow; they are never printed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let currentHeaders = new Headers()
let jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  headers: async () => currentHeaders,
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => { jar.set(k, v) },
    delete: (k: string | { name: string }) => { jar.delete(typeof k === 'string' ? k : k.name) },
  }),
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => {} }))
const sendEmail = vi.hoisted(() => vi.fn(async () => ({ sent: true })))
vi.mock('@/server/email', async (orig) => ({ ...(await orig<typeof import('@/server/email')>()), emailConfigured: () => true, sendEmail }))

import { forgotPasswordAction } from '@/app/actions/auth'
import { decryptSecret, totp } from '@/server/auth/mfa'
import { adminResetMfa, finishEnrolment, startEnrolment, verifyLoginCode } from '@/server/auth/mfa-service'
import { acceptInvitation, changeOwnPassword, completePasswordReset, requestPasswordReset } from '@/server/auth/passwords'
import { LOCKED_MESSAGE, login, SESSION_COOKIE } from '@/server/auth/session'
import { hashToken } from '@/server/auth/tokens'
import { newDeviceToken, STAFF_DEVICE_COOKIE, trustStaffBrowserAfterMfa } from '@/server/auth/trusted-device'
import { db } from '@/server/db'
import * as admin from '@/server/services/admin'
import { adminSql, ctxFor, orgId } from '../support/helpers'

const PW = 'Fictional-N1-Passw0rd!'
const NEW_PW = 'Fictional-N1-NewPass9!'
const WRONG = 'wrong-password-123'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
let EDX: string
beforeAll(async () => { EDX = await orgId('EDX') })
afterEach(() => { delete process.env.TRUST_PROXY; currentHeaders = new Headers(); jar = new Map() })
afterAll(async () => { await adminSql().end(); await db().end() })

const browser = () => new Map<string, string>()
const inBrowser = (b: Map<string, string>) => { jar = b }
const forged = () => new Headers({ 'x-forwarded-for': `${1 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}.7.9`, 'user-agent': 'vitest' })

/** A fresh fictional staff member (invited by the MD, invitation accepted). */
async function staff() {
  const md = await ctxFor('md@demo.test')
  const [role] = await adminSql()`select id from roles where org_id = ${EDX} and key = 'counsellor'`
  const email = `n1.${rand()}@example.test`
  const r = await admin.createStaff(md, { email, fullName: `N1 Test ${rand()}`, orgId: EDX, roleId: role.id })
  await acceptInvitation(r.setupPath!.split('/').pop()!, PW, PW)
  const [u] = await adminSql()`select id from user_profiles where email = ${email}`
  return { email, id: u.id as string }
}
/** Two-step login switched on for that person; returns recovery codes (used as second factor, one per sign-in). */
async function enrolMfa(email: string) {
  const ctx = await ctxFor(email)
  await startEnrolment(ctx, email)
  const [{ secret_encrypted }] = await adminSql()`select secret_encrypted from auth_private.mfa where user_id = ${ctx.userId}`
  return finishEnrolment(ctx, totp(decryptSecret(secret_encrypted), Math.floor(Date.now() / 30000) - 1))
}
/** Full sign-in in browser b: password, then two-step code, then the browser becomes trusted. Returns the session token hash. */
async function fullSignIn(b: Map<string, string>, email: string, pw: string, codes: string[]) {
  inBrowser(b)
  const r = await login(email, pw)
  expect(r).toMatchObject({ ok: true, mfaPending: true })
  const th = hashToken(b.get(SESSION_COOKIE)!)
  expect(await verifyLoginCode(th, codes.shift()!)).toEqual({ ok: true })
  expect(await trustStaffBrowserAfterMfa(th)).toMatch(/added|kept/)
  return th
}
const deviceValid = async (b: Map<string, string>, uid: string) => {
  const t = b.get(STAFF_DEVICE_COOKIE)
  if (!t) return false
  const [r] = await adminSql()`select app.staff_device_valid(${hashToken(t)}, ${uid}) as d`
  return r.d !== null
}
async function lockFromUnrecognisedBrowsers(email: string) {
  for (let i = 0; i < 5; i++) { inBrowser(browser()); currentHeaders = forged(); expect(await login(email, WRONG)).toMatchObject({ ok: false, message: 'Incorrect email or password.' }) }
}
/** The newest reset link of a person, decrypted from the queue (fictional; never printed). */
async function latestResetToken(uid: string) {
  const [o] = await adminSql()`select link_encrypted from auth_private.staff_email_outbox where user_id = ${uid} order by created_at desc limit 1`
  return decryptSecret(o.link_encrypted).split('/').pop()!
}

describe('N-1: password-reset requests can no longer lock anyone out', () => {
  it('20 reset requests for a person: sign-in still works, no failed sign-ins recorded, at most one link issued and only the newest is valid', async () => {
    const v = await staff()
    for (let i = 0; i < 20; i++) { currentHeaders = forged(); expect(await requestPasswordReset(v.email)).toBeUndefined() }
    inBrowser(browser())
    expect(await login(v.email, PW)).toMatchObject({ ok: true })
    const [{ failures }] = await adminSql()`select count(*)::int as failures from auth_private.login_attempts where email = ${v.email} and not success`
    expect(failures).toBe(0)
    const [{ n: loginFailedAudits }] = await adminSql()`select count(*)::int as n from audit_logs where action = 'login_failed' and metadata ->> 'email' = ${v.email}`
    expect(loginFailedAudits).toBe(0)
    const outcomes = await adminSql()`select outcome, count(*)::int as n from auth_private.password_reset_requests where email = ${v.email} group by 1 order by 1`
    expect(outcomes).toEqual([{ outcome: 'accepted', n: 1 }, { outcome: 'limited_email', n: 19 }]) // 1 per 2 minutes (and 3 per hour)
    const [{ valid }] = await adminSql()`select count(*)::int as valid from auth_private.password_resets where user_id = ${v.id} and used_at is null`
    expect(valid).toBe(1)
    const [al] = await adminSql()`select severity, details from security_alerts where kind = 'password_reset_limited' and subject_key = ${'email:' + v.email}`
    expect(al.severity).toBe('warning')
    expect(JSON.stringify(al.details)).not.toMatch(/reset-password|token/)
  })

  it('3 accepted per hour per email: after the 2-minute spacing, the 4th request in the hour is limited; a new link supersedes the older one', async () => {
    const v = await staff()
    for (let i = 0; i < 4; i++) {
      await requestPasswordReset(v.email)
      await adminSql()`update auth_private.password_reset_requests set requested_at = requested_at - interval '3 minutes' where email = ${v.email}`
    }
    const outcomes = (await adminSql()`select outcome from auth_private.password_reset_requests where email = ${v.email} order by id`).map((r) => r.outcome)
    expect(outcomes).toEqual(['accepted', 'accepted', 'accepted', 'limited_email'])
    const [{ valid }] = await adminSql()`select count(*)::int as valid from auth_private.password_resets where user_id = ${v.id} and used_at is null`
    expect(valid).toBe(1)
  })

  it('identical responses for existing, unknown, suspended and rate-limited addresses (function and form action)', async () => {
    const v = await staff(); const s = await staff()
    await admin.setStaffStatus(await ctxFor('md@demo.test'), s.id, 'suspended', 'Fictional N-1 test suspension')
    const fd = (email: string) => { const f = new FormData(); f.set('email', email); return f }
    const results = []
    for (const email of [v.email, `nobody.${rand()}@example.test`, s.email, v.email /* now limited */]) {
      expect(await requestPasswordReset(email)).toBeUndefined()
      results.push(await forgotPasswordAction({ ok: false }, fd(email)))
    }
    for (const r of results) expect(r).toEqual(results[0])
  })

  it('timing: existing and unknown addresses take the same time (median difference < 15 ms); no email is sent during the request', async () => {
    const v = await staff()
    sendEmail.mockClear()
    const t = { known: [] as number[], unknown: [] as number[] }
    for (let i = 0; i < 30; i++) {
      for (const [k, email] of [['known', v.email], ['unknown', `ghost.${rand()}@example.test`]] as const) {
        const t0 = performance.now(); await requestPasswordReset(email); t[k].push(performance.now() - t0)
      }
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
    expect(Math.abs(median(t.known) - median(t.unknown))).toBeLessThan(15)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('per-address limit (only with a trusted proxy): 10 requests per hour from one address', async () => {
    process.env.TRUST_PROXY = 'x-real-ip'
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`
    currentHeaders = new Headers({ 'x-real-ip': ip })
    for (let i = 0; i < 12; i++) await requestPasswordReset(`spray.${rand()}@example.test`)
    const rows = await adminSql()`select outcome from auth_private.password_reset_requests where ip = ${ip} order by id`
    expect(rows.slice(0, 10).every((r) => r.outcome === 'no_account')).toBe(true)
    expect(rows.slice(10).map((r) => r.outcome)).toEqual(['limited_ip', 'limited_ip'])
  })
})

describe('N-1: trusted browsers', () => {
  it('wrong passwords from other browsers lock only unrecognised browsers; the trusted browser still signs in AND two-step is still required', async () => {
    const v = await staff(); const codes = await enrolMfa(v.email)
    const usual = browser()
    await fullSignIn(usual, v.email, PW, codes)
    expect(usual.get(STAFF_DEVICE_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    await lockFromUnrecognisedBrowsers(v.email)
    inBrowser(browser())
    expect(await login(v.email, PW)).toEqual({ ok: false, message: LOCKED_MESSAGE }) // even the right password, on an unknown browser
    inBrowser(usual)
    const r = await login(v.email, PW)
    expect(r).toMatchObject({ ok: true, mfaPending: true }) // the cookie never skips two-step login
    const [s] = await adminSql()`select * from app.auth_resolve_session(${hashToken(usual.get(SESSION_COOKIE)!)})`
    expect(s.mfa_pending).toBe(true)
  })

  it('only the token HASH is stored; a browser becomes trusted only after the two-step code, never after the password alone', async () => {
    const v = await staff(); const codes = await enrolMfa(v.email)
    const b = browser(); inBrowser(b)
    expect(await login(v.email, PW)).toMatchObject({ ok: true, mfaPending: true })
    const th = hashToken(b.get(SESSION_COOKIE)!)
    expect(await trustStaffBrowserAfterMfa(th)).toBeNull() // two-step not done yet
    expect(b.get(STAFF_DEVICE_COOKIE)).toBeUndefined()
    expect(await verifyLoginCode(th, codes.shift()!)).toEqual({ ok: true })
    expect(await trustStaffBrowserAfterMfa(th)).toBe('added')
    const raw = b.get(STAFF_DEVICE_COOKIE)!
    const rows = await adminSql()`select token_hash from auth_private.trusted_devices where user_id = ${v.id}`
    expect(rows).toEqual([{ token_hash: hashToken(raw) }])
    expect(JSON.stringify(rows)).not.toContain(raw)
    // an account WITHOUT two-step login never gets a trusted browser
    const n = await staff(); const nb = browser(); inBrowser(nb)
    expect(await login(n.email, PW)).toMatchObject({ ok: true, mfaPending: false })
    expect(await trustStaffBrowserAfterMfa(hashToken(nb.get(SESSION_COOKIE)!))).toBeNull()
  })

  it('a trusted browser has its own limit: 10 failures lock that browser only', async () => {
    const v = await staff(); const codes = await enrolMfa(v.email)
    const usual = browser(); await fullSignIn(usual, v.email, PW, codes)
    inBrowser(usual)
    for (let i = 0; i < 10; i++) expect(await login(v.email, WRONG)).toMatchObject({ ok: false, message: 'Incorrect email or password.' })
    expect(await login(v.email, PW)).toEqual({ ok: false, message: LOCKED_MESSAGE })
    inBrowser(browser())
    expect(await login(v.email, PW)).toMatchObject({ ok: true }) // unrecognised browsers have their own (untouched) counter
  })

  it('cookie theft: a copied cookie alone signs nobody in, still needs password AND two-step code, and has the same 10-failure limit', async () => {
    const v = await staff(); const codes = await enrolMfa(v.email)
    const usual = browser(); await fullSignIn(usual, v.email, PW, codes)
    const thief = new Map([[STAFF_DEVICE_COOKIE, usual.get(STAFF_DEVICE_COOKIE)!]])
    inBrowser(thief)
    const { getSession } = await import('@/server/auth/session')
    expect(await getSession()).toBeNull()
    for (let i = 0; i < 10; i++) await login(v.email, WRONG)
    expect(await login(v.email, PW)).toEqual({ ok: false, message: LOCKED_MESSAGE })
  })

  it('wrong account: a trusted cookie of person A gives nothing for person B', async () => {
    const a = await staff(); const codesA = await enrolMfa(a.email)
    const b = await staff()
    const aBrowser = browser(); await fullSignIn(aBrowser, a.email, PW, codesA)
    await lockFromUnrecognisedBrowsers(b.email)
    inBrowser(aBrowser)
    expect(await login(b.email, PW)).toEqual({ ok: false, message: LOCKED_MESSAGE })
    expect(await deviceValid(aBrowser, b.id)).toBe(false)
    expect(await deviceValid(aBrowser, a.id)).toBe(true)
  })

  it('replay after expiry: an expired trusted browser counts as unrecognised', async () => {
    const v = await staff(); const codes = await enrolMfa(v.email)
    const usual = browser(); await fullSignIn(usual, v.email, PW, codes)
    await adminSql()`update auth_private.trusted_devices set expires_at = now() - interval '1 second' where user_id = ${v.id}`
    expect(await deviceValid(usual, v.id)).toBe(false)
    await lockFromUnrecognisedBrowsers(v.email)
    inBrowser(usual)
    expect(await login(v.email, PW)).toEqual({ ok: false, message: LOCKED_MESSAGE })
  })

  it('revocation on every account-security event: sign out everywhere, password change, two-step reset, suspension, termination', async () => {
    const md = await ctxFor('md@demo.test')
    const events: [string, (u: { id: string; email: string }, th: string) => Promise<unknown>][] = [
      ['sign out everywhere', async (u) => admin.revokeSessions(await ctxFor(u.email), u.id)],
      ['password change', async (u, th) => {
        const [s] = await adminSql()`select id from auth_private.sessions where token_hash = ${th}`
        await changeOwnPassword(u.id, s.id, u.email, PW, NEW_PW)
      }],
      ['two-step reset', async (u) => adminResetMfa(md, u.id, 'Identity verified in person (fictional N-1 test)')],
      ['suspension', async (u) => admin.setStaffStatus(md, u.id, 'suspended', 'Fictional N-1 test suspension')],
      ['termination', async (u) => admin.setStaffStatus(md, u.id, 'terminated', 'Fictional N-1 test termination')],
    ]
    for (const [name, act] of events) {
      const v = await staff(); const codes = await enrolMfa(v.email)
      const usual = browser(); const th = await fullSignIn(usual, v.email, PW, codes)
      expect(await deviceValid(usual, v.id), name).toBe(true)
      await act(v, th)
      expect(await deviceValid(usual, v.id), name).toBe(false)
      const [d] = await adminSql()`select revoked_at, revoked_reason from auth_private.trusted_devices where user_id = ${v.id}`
      expect(d.revoked_at, name).not.toBeNull()
      if (name === 'suspension') { // reactivation does not bring the trust back
        await admin.setStaffStatus(md, v.id, 'active', 'Fictional N-1 test reactivation')
        expect(await deviceValid(usual, v.id)).toBe(false)
      }
    }
  })
})

describe('N-1: recovery on a new device, race-free counting, limits and alerts', () => {
  it('locked out on every unrecognised browser → a password reset on a NEW browser restores access (two-step still required)', async () => {
    const v = await staff(); const codes = await enrolMfa(v.email)
    await lockFromUnrecognisedBrowsers(v.email)
    const fresh = browser(); inBrowser(fresh)
    expect(await login(v.email, PW)).toEqual({ ok: false, message: LOCKED_MESSAGE })
    await requestPasswordReset(v.email)
    const device = newDeviceToken()
    await completePasswordReset(await latestResetToken(v.id), NEW_PW, NEW_PW, device.hash)
    fresh.set(STAFF_DEVICE_COOKIE, device.token) // what the reset action does
    expect(await deviceValid(fresh, v.id)).toBe(true)
    inBrowser(fresh)
    expect(await login(v.email, NEW_PW)).toMatchObject({ ok: true, mfaPending: true })
    inBrowser(browser()) // the failure count for unrecognised browsers was cleared too
    expect(await login(v.email, NEW_PW)).toMatchObject({ ok: true, mfaPending: true })
    expect(codes.length).toBeGreaterThan(0)
    const [a] = await adminSql()`select count(*)::int as n from audit_logs where action = 'lockout_cleared_by_password_reset' and entity_id = ${v.id}`
    expect(a.n).toBe(1)
  })

  it('20 parallel wrong passwords: exactly 5 are checked, 15 refused (no race); the right password is refused afterwards', async () => {
    const v = await staff()
    inBrowser(browser())
    await Promise.all(Array.from({ length: 20 }, () => login(v.email, WRONG)))
    const [c] = await adminSql()`select count(*) filter (where not refused)::int as checked, count(*) filter (where refused)::int as refused
                                   from auth_private.login_attempts where email = ${v.email}`
    expect(c).toEqual({ checked: 5, refused: 15 })
    expect(await login(v.email, PW)).toEqual({ ok: false, message: LOCKED_MESSAGE })
  })

  it('refused attempts are recorded and alerted but do not extend the lock; the lock ends 15 minutes after the 5th real failure', async () => {
    const v = await staff()
    await lockFromUnrecognisedBrowsers(v.email)
    inBrowser(browser())
    for (let i = 0; i < 5; i++) expect(await login(v.email, PW)).toEqual({ ok: false, message: LOCKED_MESSAGE })
    const [al] = await adminSql()`select severity from security_alerts where kind = 'repeated_failed_logins' and subject_key = ${'email:' + v.email}`
    expect(al.severity).toBe('high') // 10 failures incl. refused
    await adminSql()`update auth_private.login_attempts set attempted_at = attempted_at - interval '16 minutes' where email = ${v.email} and not refused`
    expect(await login(v.email, PW)).toMatchObject({ ok: true })
  })

  it('many accounts failing at once (distributed guessing, no trusted proxy) raises "Many failed sign-ins across accounts" without blocking anyone', async () => {
    for (let a = 0; a < 20; a++) {
      const email = `stuffing.${rand()}@example.test`
      for (let i = 0; i < 5; i++) { currentHeaders = forged(); await login(email, WRONG) }
    }
    const [al] = await adminSql()`select severity, details from security_alerts where kind = 'failed_logins_many_accounts' and subject_key = 'global'`
    expect(al.severity).toBe('high')
    expect(al.details.accounts_15_min).toBeGreaterThanOrEqual(20)
    const v = await staff(); inBrowser(browser())
    expect(await login(v.email, PW)).toMatchObject({ ok: true })
  })
})
