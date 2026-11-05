/**
 * Finding N-7: student-portal set-up and password-reset links go only through the secure, encrypted portal email queue
 * (auth_private.portal_email_outbox). The email provider is replaced by a stub; nothing leaves the machine.
 * Fictional students only; links and tokens are never printed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': 'vitest' }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}))
const provider = vi.hoisted(() => ({
  configured: true,
  sendEmail: vi.fn(async (_org: string, _to: string, _subject: string, _body: string) =>
    ({ ok: true, provider: 'smtp', providerId: 'stub-1' }) as { ok: true; provider: string; providerId: string | null } | { ok: false; provider: string; error: string; transient: boolean }),
}))
vi.mock('@/lib/notifications/providers', async (orig) => ({
  ...(await orig<typeof import('@/lib/notifications/providers')>()),
  channelConfigured: () => provider.configured,
  sendEmail: (org: string, to: string, subject: string, body: string) => provider.sendEmail(org, to, subject, body),
}))

import { hashToken } from '@/lib/auth/tokens'
import { anonymous, db } from '@/lib/db'
import { deliverPortalEmails } from '@/lib/notifications/portal-email'
import { checkPasswordLink, passwordLogin, requestPasswordReset, setPasswordWithLink } from '@/services/portal'
import * as notifications from '@/services/notifications'
import * as pa from '@/services/portal-accounts'
import * as students from '@/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../support/helpers'

const PW = 'Fictional-N7-Portal-Pass1!'
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const LINK_RE = /https?:\/\/\S+\/portal\/password\?token=[A-Za-z0-9_-]+/
let EDX: string
beforeAll(async () => { EDX = await orgId('EDX') })
beforeEach(async () => {
  provider.configured = true
  provider.sendEmail.mockReset()
  provider.sendEmail.mockImplementation(async () => ({ ok: true, provider: 'smtp', providerId: 'stub-1' }))
  process.env.NOTIFICATIONS_MODE = 'live'
  // isolate each test from messages queued by earlier tests
  await adminSql()`update auth_private.portal_email_outbox set status = 'skipped', link_encrypted = null, finished_at = now() where status in ('queued', 'sending')`
})
afterEach(() => { process.env.NOTIFICATIONS_MODE = 'test'; delete process.env.NOTIFICATIONS_TEST_RECIPIENTS })
afterAll(async () => { await adminSql().end(); await db().end() })

async function student(verified = true) {
  const mgr = await ctxFor('edx.manager@demo.test')
  const email = `n7.${rand()}${rand()}@example.test`
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'N7 Portal Student', phone: `+91 90094 ${rand()}`, email })
  if (!r.ok) throw new Error('duplicate')
  if (verified) {
    await adminSql().begin(async (tx) => {
      await tx`select set_config('app.email_verify', 'on', true)`
      await tx`update students set email_status = 'verified', email_verified_at = now() where id = ${r.id}`
    })
  }
  const [s] = await adminSql()`select student_code from students where id = ${r.id}`
  return { mgr, id: r.id, email, code: s.student_code as string }
}
const outbox = async (studentId: string) => adminSql()`select * from auth_private.portal_email_outbox where student_id = ${studentId} order by created_at`
const latest = async (studentId: string) => (await outbox(studentId)).at(-1)!
const makeDue = (studentId: string) => adminSql()`update auth_private.portal_email_outbox set next_attempt_at = now() where student_id = ${studentId}`
/** the link as the student receives it (from the stubbed provider) */
function delivered(to: string) {
  const calls = provider.sendEmail.mock.calls.filter((c) => c[1] === to)
  return calls.map((c) => c[3].match(LINK_RE)?.[0]).filter(Boolean) as string[]
}
const tokenOf = (link: string) => new URL(link).searchParams.get('token')!
/** the student sets a first password through the emailed set-up link */
async function withPassword(s: Awaited<ReturnType<typeof student>>) {
  await pa.issuePortalLink(s.mgr, s.id)
  await deliverPortalEmails()
  expect(await setPasswordWithLink(tokenOf(delivered(s.email).at(-1)!), PW, PW)).toBe(s.code)
  provider.sendEmail.mockClear()
}
/** what a staff member can read, as themselves (each read in its own transaction; refused reads count as nothing) */
async function staffView(email: string, studentId: string) {
  const read = (q: (tx: Parameters<Parameters<typeof as>[1]>[0]) => Promise<unknown>) => as(email, q).catch(() => [])
  return JSON.stringify([
    await read((tx) => tx`select * from notification_messages where student_id = ${studentId}`),
    await read((tx) => tx`select * from audit_logs order by id desc limit 200`),
    await read((tx) => tx`select * from student_events where student_id = ${studentId}`),
    await read((tx) => tx`select * from app.portal_email_status(${studentId})`),
  ])
}
/** everything staff-facing or logged where a link could leak */
const everywhere = async () => JSON.stringify(await adminSql()`select
  (select json_agg(a) from (select * from audit_logs order by id desc limit 500) a) as audit,
  (select json_agg(e) from student_events e) as events,
  (select json_agg(m) from notification_messages m) as outbox,
  (select json_agg(s) from security_alerts s) as alerts`)

describe('N-7: the queue keeps portal links encrypted and away from staff', () => {
  it('set-up link: stored encrypted, delivered once to the student, then wiped; it appears nowhere staff can look', async () => {
    const s = await student()
    expect((await pa.issuePortalLink(s.mgr, s.id)).mode).toBe('emailed')
    const q = await latest(s.id)
    expect(q).toMatchObject({ kind: 'portal_account_setup', status: 'queued', to_address: s.email, attempts: 0 })
    expect(q.link_encrypted).toMatch(/^v1:/)
    expect(q.link_encrypted).not.toMatch(/token=|portal\/password/)
    expect(await adminSql()`select 1 from notification_messages where student_id = ${s.id} and event_key in ('portal_account_setup', 'portal_password_reset')`).toHaveLength(0)

    const sum = await deliverPortalEmails()
    expect(sum.sent).toBeGreaterThanOrEqual(1)
    const [link] = delivered(s.email)
    expect(link).toBeTruthy()
    expect(provider.sendEmail.mock.calls.find((c) => c[1] === s.email)![0]).toBe('EDX') // the company's own sender
    expect(await latest(s.id)).toMatchObject({ status: 'sent', link_encrypted: null, attempts: 1, provider_message_id: 'stub-1' })
    await deliverPortalEmails()
    expect(delivered(s.email)).toHaveLength(1) // never twice

    const token = tokenOf(link)
    expect(await everywhere()).not.toContain(token)
    // what an outbox holder (manager, MD) and a contact-details holder (counsellor) can read, as themselves
    for (const email of ['edx.manager@demo.test', 'md@demo.test', 'edx.counsellor@demo.test']) {
      const seen = await staffView(email, s.id)
      expect(seen, email).not.toContain(token)
      expect(seen, email).not.toContain('v1:')
    }
    const msgs = await notifications.listMessages(await ctxFor('edx.manager@demo.test'), [EDX], { studentId: s.id })
    expect(msgs.rows.filter((r) => /portal_account_setup|portal_password_reset/.test(r.event_key))).toHaveLength(0)
    expect(JSON.stringify(msgs)).not.toContain(token)

    // the student completes the set-up and signs in (normal functionality preserved)
    expect(await checkPasswordLink(token)).toBe(s.code)
    expect(await setPasswordWithLink(token, PW, PW)).toBe(s.code)
    expect(await passwordLogin(s.code, PW)).toBe(true)
    // staff see the delivery status only
    const info = await pa.portalAccount(s.mgr, s.id)
    expect(info.lastEmail).toMatchObject({ kind: 'portal_account_setup', status: 'sent' })
    expect(Object.keys(info.lastEmail!)).not.toContain('link_encrypted')
  })

  it('forgot password: the reset link reaches only the student; the student resets the password; replay is refused', async () => {
    const s = await student()
    await withPassword(s)
    await requestPasswordReset(s.code)
    expect(await latest(s.id)).toMatchObject({ kind: 'portal_password_reset', status: 'queued' })
    await deliverPortalEmails()
    const [link] = delivered(s.email)
    const token = tokenOf(link)
    // counsellor with contact access and manager with outbox access: nothing readable
    for (const email of ['edx.counsellor@demo.test', 'edx.manager@demo.test']) expect(await staffView(email, s.id), email).not.toContain(token)
    expect(await everywhere()).not.toContain(token)
    expect(await setPasswordWithLink(token, PW + 'x', PW + 'x')).toBe(s.code)
    expect(await passwordLogin(s.code, PW + 'x')).toBe(true)
    // single use: a replay of the same link is refused
    expect(await checkPasswordLink(token)).toBeNull()
    await expect(setPasswordWithLink(token, PW + 'y', PW + 'y')).rejects.toThrow()
    expect(await passwordLogin(s.code, PW + 'x')).toBe(true)
  })

  it('test mode: nothing is sent to non-allow-listed students and the link is wiped (status "test"); allow-listed addresses receive it', async () => {
    process.env.NOTIFICATIONS_MODE = 'test'
    const s = await student()
    await pa.issuePortalLink(s.mgr, s.id)
    await deliverPortalEmails()
    expect(await latest(s.id)).toMatchObject({ status: 'test', link_encrypted: null, last_error: 'Test mode: not sent' })
    expect(provider.sendEmail).not.toHaveBeenCalled()
    expect(await adminSql()`select 1 from notification_messages where student_id = ${s.id} and event_key in ('portal_account_setup', 'portal_password_reset')`).toHaveLength(0)
    const t = await student()
    process.env.NOTIFICATIONS_TEST_RECIPIENTS = t.email
    await pa.issuePortalLink(t.mgr, t.id)
    await deliverPortalEmails()
    expect(await latest(t.id)).toMatchObject({ status: 'sent', link_encrypted: null })
    expect(delivered(t.email)).toHaveLength(1)
  })

  it('email not configured: skipped and wiped; the student is not emailed (staff issue a new link to hand over)', async () => {
    provider.configured = false
    const s = await student()
    await pa.issuePortalLink(s.mgr, s.id)
    await deliverPortalEmails()
    expect(await latest(s.id)).toMatchObject({ status: 'skipped', link_encrypted: null })
    expect(provider.sendEmail).not.toHaveBeenCalled()
    expect((await pa.portalAccount(s.mgr, s.id)).lastEmail?.status).toBe('skipped')
  })
})

describe('N-7: expiry, revocation and replay', () => {
  it('a delivered link that has expired cannot be used; an email whose link expired before sending is never sent', async () => {
    const s = await student()
    await pa.issuePortalLink(s.mgr, s.id)
    await deliverPortalEmails()
    const token = tokenOf(delivered(s.email)[0])
    await adminSql()`update auth_private.student_account_tokens set expires_at = now() - interval '1 second' where token_hash = ${hashToken(token)}`
    expect(await checkPasswordLink(token)).toBeNull()
    await expect(setPasswordWithLink(token, PW, PW)).rejects.toThrow()

    const t = await student()
    await pa.issuePortalLink(t.mgr, t.id)
    await adminSql()`update auth_private.portal_email_outbox set expires_at = now() - interval '1 second' where student_id = ${t.id}`
    await deliverPortalEmails()
    expect(await latest(t.id)).toMatchObject({ status: 'expired', link_encrypted: null })
    expect(delivered(t.email)).toHaveLength(0)
  })

  it('re-issuing revokes the older link: its queued email is revoked and wiped at once, a delivered older link stops working', async () => {
    const s = await student()
    await pa.issuePortalLink(s.mgr, s.id)
    await pa.issuePortalLink(s.mgr, s.id) // before the first was sent
    const rows = await outbox(s.id)
    expect(rows.map((r) => r.status)).toEqual(['revoked', 'queued'])
    expect(rows[0].link_encrypted).toBeNull()
    await deliverPortalEmails()
    const [first] = delivered(s.email)
    expect(delivered(s.email)).toHaveLength(1) // only the current link was sent
    await pa.issuePortalLink(s.mgr, s.id)
    await deliverPortalEmails()
    const links = delivered(s.email)
    expect(links).toHaveLength(2)
    expect(await checkPasswordLink(tokenOf(first))).toBeNull()
    await expect(setPasswordWithLink(tokenOf(first), PW, PW)).rejects.toThrow()
    expect(await setPasswordWithLink(tokenOf(links[1]), PW, PW)).toBe(s.code)
  })

  it('disabling the account revokes a queued link email and the link itself', async () => {
    const s = await student()
    await withPassword(s)
    await requestPasswordReset(s.code)
    await pa.setPortalAccountEnabled(s.mgr, s.id, false, 'Left the programme (fictional N-7 test)')
    expect(await latest(s.id)).toMatchObject({ status: 'revoked', link_encrypted: null })
    provider.sendEmail.mockClear()
    await deliverPortalEmails()
    expect(delivered(s.email)).toHaveLength(0)
  })

  it('a link revoked between queueing and claiming is caught by the claim-time check', async () => {
    const s = await student()
    await pa.issuePortalLink(s.mgr, s.id)
    // simulate a revocation the token trigger did not see (defence in depth): the account disabled directly, token untouched
    await adminSql()`update auth_private.student_accounts set status = 'disabled' where student_id = ${s.id}`
    await deliverPortalEmails()
    expect(await latest(s.id)).toMatchObject({ status: 'revoked', link_encrypted: null })
    expect(delivered(s.email)).toHaveLength(0)
  })
})

describe('N-7: delivery reliability', () => {
  it('three senders at the same time deliver each message exactly once', async () => {
    const people = await Promise.all(Array.from({ length: 6 }, () => student()))
    for (const p of people) await pa.issuePortalLink(p.mgr, p.id)
    provider.sendEmail.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 20)); return { ok: true, provider: 'smtp', providerId: 'stub-2' } })
    await Promise.all([deliverPortalEmails(), deliverPortalEmails(), deliverPortalEmails()])
    for (const p of people) {
      expect(delivered(p.email), p.email).toHaveLength(1)
      expect(await latest(p.id)).toMatchObject({ status: 'sent', link_encrypted: null })
    }
  })

  it('temporary provider failure: retried with back-off, link kept encrypted while pending; after 5 attempts → failed, wiped and audited', async () => {
    const s = await student()
    provider.sendEmail.mockImplementation(async () => ({ ok: false, provider: 'smtp', error: '421 try later', transient: true }))
    await pa.issuePortalLink(s.mgr, s.id)
    await deliverPortalEmails()
    let q = await latest(s.id)
    expect(q).toMatchObject({ status: 'queued', attempts: 1, last_error: '421 try later' })
    expect(q.link_encrypted).toMatch(/^v1:/)
    expect(new Date(q.next_attempt_at).getTime()).toBeGreaterThan(Date.now())
    for (let i = 0; i < 6; i++) { await makeDue(s.id); await deliverPortalEmails() }
    q = await latest(s.id)
    expect(q).toMatchObject({ status: 'failed', attempts: 5, link_encrypted: null })
    expect(provider.sendEmail.mock.calls.filter((c) => c[1] === s.email)).toHaveLength(5)
    const [a] = await adminSql()`select outcome, org_id, student_id, metadata from audit_logs where action = 'portal_link_email_failed' and student_id = ${s.id}`
    expect(a).toMatchObject({ outcome: 'failure', org_id: EDX, student_id: s.id })
    expect(JSON.stringify(a)).not.toMatch(/token=|portal\/password|v1:/)
    expect((await pa.portalAccount(s.mgr, s.id)).lastEmail?.status).toBe('failed')
  })

  it('permanent provider failure: failed at once (no retry), link wiped', async () => {
    const s = await student()
    provider.sendEmail.mockImplementation(async () => ({ ok: false, provider: 'smtp', error: '550 no such user', transient: false }))
    await pa.issuePortalLink(s.mgr, s.id)
    await deliverPortalEmails()
    expect(await latest(s.id)).toMatchObject({ status: 'failed', attempts: 1, link_encrypted: null })
  })
})

describe('provider errors are masked before storage', () => {
  it('a provider echoing the one-time link leaves neither the link nor its token in the queue or the audit log', async () => {
    const s = await student()
    provider.sendEmail.mockImplementation(async (_org, _to, _subject, body) => ({ ok: false, provider: 'smtp', error: `550 rejected: ${body}`, transient: false }))
    await pa.issuePortalLink(s.mgr, s.id)
    await deliverPortalEmails()
    const m = await latest(s.id)
    expect(m).toMatchObject({ status: 'failed', link_encrypted: null })
    expect(m.last_error).toMatch(/^550 rejected/)
    expect(m.last_error).not.toMatch(LINK_RE)
    expect(m.last_error).not.toMatch(/token=[A-Za-z0-9_-]{4}/)
    const logs = await adminSql()`select metadata::text as m from audit_logs where action = 'portal_link_email_failed' and entity_id = ${m.account_id}`
    expect(logs.length).toBeGreaterThan(0)
    for (const l of logs) expect(l.m).not.toMatch(/token=[A-Za-z0-9_-]{4}/)
  })
})

describe('N-7: direct access is denied', () => {
  it('the application role cannot read the queue; sender functions refuse every signed-in staff context, even the MD', async () => {
    await expectDbError(db()`select * from auth_private.portal_email_outbox limit 1`, '42501')
    for (const email of ['md@demo.test', 'admin@demo.test', 'edx.manager@demo.test', 'edx.counsellor@demo.test']) {
      await expectDbError(as(email, (tx) => tx`select * from auth_private.portal_email_outbox limit 1`), '42501')
      await expectDbError(as(email, (tx) => tx`select * from app.portal_email_claim(10)`), '42501')
      await expectDbError(as(email, (tx) => tx`select app.portal_email_finish(gen_random_uuid(), 'sent', null, null, null)`), '42501')
      await expectDbError(as(email, (tx) => tx`select app.portal_email_housekeeping()`), '42501')
    }
  })

  it('plain links are refused; portal-link messages can no longer be put in the staff outbox', async () => {
    const s = await student()
    await expectDbError(as('edx.manager@demo.test', (tx) => tx`select app.issue_portal_account_link(${s.id}, ${hashToken('x' + rand())}, 'http://x/portal/password?token=abc')`), '22023')
    await expectDbError(anonymous((tx) => tx`select app.portal_request_reset(${s.code}, ${hashToken('y' + rand())}, 'http://x/portal/password?token=abc')`), '22023')
    await expectDbError(adminSql()`insert into auth_private.portal_email_outbox (org_id, student_id, account_id, token_id, kind, template_id, to_address, link_encrypted, expires_at)
      select ${EDX}, ${s.id}, gen_random_uuid(), gen_random_uuid(), 'portal_password_reset', gen_random_uuid(), 'a@example.test', 'http://plain', now()`, '23514')
    for (const kind of ['portal_account_setup', 'portal_password_reset']) {
      await expectDbError(adminSql()`insert into notification_messages (org_id, student_id, event_key, channel, recipient_type, to_address, params, status)
        values (${EDX}, ${s.id}, ${kind}, 'email', 'student', ${s.email}, ${adminSql().json({ link: 'http://x/portal/password?token=abc' })}, 'queued')`, '42501')
    }
    // a pending link in a final state is impossible (CHECK)
    await pa.issuePortalLink(s.mgr, s.id)
    await expectDbError(adminSql()`update auth_private.portal_email_outbox set status = 'sent' where student_id = ${s.id} and status = 'queued'`, '23514')
    await expectDbError(adminSql()`update auth_private.portal_email_outbox set status = 'test' where student_id = ${s.id} and status = 'queued'`, '23514')
    await expectDbError(adminSql()`update auth_private.portal_email_outbox set link_encrypted = 'v1:plain https://x' where student_id = ${s.id} and status = 'queued'`, '23514')
  })

  it('delivery status respects company isolation and permissions; it never contains the link', async () => {
    const s = await student()
    await pa.issuePortalLink(s.mgr, s.id)
    for (const email of ['edx.manager@demo.test', 'md@demo.test']) {
      const r = await as(email, (tx) => tx`select * from app.portal_email_status(${s.id})`)
      expect(r, email).toHaveLength(1)
      expect(Object.keys(r[0])).toEqual(['kind', 'status', 'created_at', 'finished_at', 'attempts', 'last_error'])
    }
    for (const email of ['grd.manager@demo.test', 'grd.counsellor@demo.test']) {
      expect(await as(email, (tx) => tx`select * from app.portal_email_status(${s.id})`), email).toHaveLength(0)
    }
  })
})

describe('N-7: legacy outbox rows (created before 0036)', () => {
  /** a legacy row as 0025 created it (bypassing the new insert guard, test database only) */
  async function legacyRow(s: { id: string; email: string }, status: string, token: string) {
    return adminSql().begin(async (tx) => {
      await tx`set local session_replication_role = replica`
      const [m] = await tx`insert into notification_messages (org_id, student_id, event_key, channel, recipient_type, to_address, params, body, status)
        values (${EDX}, ${s.id}, 'portal_password_reset', 'email', 'student', ${s.email}, ${tx.json({ link: `http://x/portal/password?token=${token}` })},
                ${`Open http://x/portal/password?token=${token}`}, ${status}) returning id`
      return m.id as string
    })
  }

  it('outbox holders cannot read them in any status; finishing or updating one strips the link in every status, test mode included', async () => {
    const s = await student()
    for (const status of ['test', 'queued', 'sent', 'failed', 'skipped']) {
      const token = `LEGACY${rand()}${rand()}abcdefgh`
      const id = await legacyRow(s, 'sending', token)
      for (const email of ['edx.manager@demo.test', 'md@demo.test', 'edx.counsellor@demo.test']) {
        expect(await as(email, (tx) => tx`select 1 from notification_messages where id = ${id}`), `${email} ${status}`).toHaveLength(0)
      }
      await adminSql()`select app.finish_notification(${id}, ${status}, null, null, null, 'Subject', ${`Body http://x/portal/password?token=${token}`}, 60)`
      const [m] = await adminSql()`select status, params, body from notification_messages where id = ${id}`
      expect(m.status).toBe(status)
      expect(JSON.stringify(m), status).not.toContain(token)
    }
    const token = `LEGACY${rand()}${rand()}zyxwvuts`
    const id = await legacyRow(s, 'test', token)
    await adminSql()`update notification_messages set attempts = attempts where id = ${id}` // any update strips the link
    expect(JSON.stringify(await adminSql()`select params, body from notification_messages where id = ${id}`)).not.toContain(token)
  })

  it('other message kinds keep their existing behaviour (no scope change for login codes and email verification)', async () => {
    const [p] = await adminSql()`select pg_get_functiondef('app.finish_notification(uuid,text,text,text,text,text,text,integer)'::regprocedure) as d`
    expect(p.d).toContain(`(v_event in ('portal_login_code', 'email_verification') and p_status in ('sent', 'failed', 'skipped'))`)
  })
})
