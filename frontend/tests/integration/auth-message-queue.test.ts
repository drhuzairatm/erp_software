/**
 * Finding N-8: portal sign-in codes and email-verification links go only through the secure, encrypted authentication
 * queue (auth_private.auth_message_outbox). Email is replaced by a stub; WhatsApp uses the REAL Gallabox request code
 * with a stubbed network. Nothing leaves the machine. Fictional students only; codes and links are never printed.
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
vi.mock('@/server/notifications/providers', async (orig) => {
  const real = await orig<typeof import('@/server/notifications/providers')>()
  return {
    ...real,
    channelConfigured: (channel: string, org: string) => (channel === 'whatsapp' ? real.channelConfigured('whatsapp', org) : provider.configured),
    sendEmail: (org: string, to: string, subject: string, body: string) => provider.sendEmail(org, to, subject, body),
  }
})

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import { GET as cronNotifications } from '@/app/api/cron/notifications/route'
import { decryptAuthSecret, encryptAuthSecret } from '@/server/auth/auth-message-crypto'
import { encryptSecret } from '@/server/auth/mfa'
import { anonymous, db } from '@/server/db'
import { deliverAuthMessages, maskSecretText } from '@/server/notifications/auth-message'
import { TEST_MAILBOX_DIR } from '@/server/notifications/test-mailbox'
import { requestCode, verifyCode } from '@/server/portal'
import * as notifications from '@/server/services/notifications'
import * as pp from '@/server/services/passport'
import * as students from '@/server/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../../../backend/tests/support/helpers'

const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const hmac = (v: string) => createHmac('sha256', process.env.STORAGE_SIGNING_SECRET!).update(v).digest('hex')
const ENV = { ...process.env }
let EDX: string
const logged: string[] = []
beforeAll(async () => {
  EDX = await orgId('EDX')
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(' ')) })
  }
})
beforeEach(async () => {
  provider.configured = true
  provider.sendEmail.mockReset()
  provider.sendEmail.mockImplementation(async () => ({ ok: true, provider: 'smtp', providerId: 'stub-1' }))
  process.env.NOTIFICATIONS_MODE = 'live'
  await adminSql()`update auth_private.auth_message_outbox set status = 'skipped', secret_encrypted = null, finished_at = now() where status in ('queued', 'sending')`
})
afterEach(() => { process.env = { ...ENV }; vi.unstubAllGlobals() })
afterAll(async () => {
  // no secret was ever written to the console
  for (const l of logged) expect(l).not.toMatch(/\b\d{6}\b|verify-email\?token=|am1:/)
  await adminSql().end(); await db().end()
})

// unique per run and per student (duplicate detection compares the last 10 digits across the whole test database; the
// 931 range is used by no other test)
const RUN = String(Math.floor(Math.random() * 900) + 100)
let seq = 0
const uniquePhone = () => `+91 931${RUN}${String(++seq).padStart(4, '0')}`
async function student(phone = uniquePhone()) {
  const mgr = await ctxFor('edx.manager@demo.test')
  const email = `n8.${RUN}.${String(seq).padStart(4, '0')}.${rand()}@example.test`
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'N8 Auth Student', phone, email })
  if (!r.ok) throw new Error('duplicate')
  return { mgr, id: r.id, email, phone }
}
const rows = async (studentId: string) => adminSql()`select * from auth_private.auth_message_outbox where student_id = ${studentId} order by created_at`
const latest = async (studentId: string) => (await rows(studentId)).at(-1)!
const makeDue = (studentId: string) => adminSql()`update auth_private.auth_message_outbox set next_attempt_at = now() where student_id = ${studentId}`
const emailsTo = (to: string) => provider.sendEmail.mock.calls.filter((c) => c[1] === to)
const codeIn = (body: string) => body.match(/\b(\d{6})\b/)?.[1]
const linkIn = (body: string) => body.match(/https?:\/\/\S+\/verify-email\?token=[A-Za-z0-9_-]+/)?.[0]
/** the secret currently in the queue for a student (read with the server key, as the sender would) */
async function queuedSecret(studentId: string) {
  const q = await latest(studentId)
  return decryptAuthSecret(q.kind, q.secret_encrypted)
}

const STAFF = ['md@demo.test', 'ceo@demo.test', 'admin@demo.test', 'edx.manager@demo.test', 'edx.counsellor@demo.test', 'edx.finance@demo.test', 'grd.manager@demo.test']
/** everything a staff member can reach, as themselves: Messages service, outbox, redacted log, audit, events, alerts, queue */
async function staffCanSee(email: string, studentId: string) {
  const ctx = await ctxFor(email)
  const read = <T,>(p: Promise<T>) => p.catch(() => [])
  return JSON.stringify([
    await read(notifications.listMessages(ctx, ctx.memberships.map((m) => m.orgId), { studentId })),
    await read(notifications.listMessages(ctx, ctx.memberships.map((m) => m.orgId), {})),
    await read(as(email, (tx) => tx`select * from notification_messages where student_id = ${studentId}`)),
    await read(as(email, (tx) => tx`select * from app.auth_message_log(${tx.array([EDX])}::uuid[], ${studentId}, null, null, null, 100)`)),
    await read(as(email, (tx) => tx`select * from audit_logs order by id desc limit 300`)),
    await read(as(email, (tx) => tx`select * from student_events where student_id = ${studentId}`)),
    await read(as(email, (tx) => tx`select * from security_alerts`)),
    await read(as(email, (tx) => tx`select * from auth_private.auth_message_outbox`)),
  ])
}
async function expectHidden(secret: string, studentId: string, label: string) {
  for (const email of STAFF) expect(await staffCanSee(email, studentId), `${label} – ${email}`).not.toContain(secret)
  const everywhere = JSON.stringify(await adminSql()`select
    (select json_agg(a) from (select * from audit_logs order by id desc limit 500) a) as audit,
    (select json_agg(m) from notification_messages m where m.student_id = ${studentId}) as outbox,
    (select json_agg(e) from student_events e where e.student_id = ${studentId}) as events,
    (select json_agg(s) from security_alerts s) as alerts`)
  expect(everywhere, label).not.toContain(secret)
}

describe('N-8: staff never see sign-in codes or verification links, in any status', () => {
  it('queued, sending, sent, failed, skipped, test, expired and cancelled: MD, CEO, Admin, Manager, Counsellor, Finance see no secret', async () => {
    const statuses: string[] = []
    const check = async (s: { id: string }, _label: string) => {
      const q = await latest(s.id)
      statuses.push(q.status)
      return q
    }
    // queued
    const a = await student(); const challengeA = await requestCode(a.email); const codeA = await queuedSecret(a.id)
    expect((await check(a, 'queued')).status).toBe('queued')
    await expectHidden(codeA, a.id, 'queued')
    // sending (claimed by a sender, not yet finished)
    const claimed = await anonymous((tx) => tx<{ id: string }[]>`select id from app.auth_message_claim(100)`)
    expect((await check(a, 'sending')).status).toBe('sending')
    await expectHidden(codeA, a.id, 'sending')
    for (const c of claimed) await anonymous((tx) => tx`select app.auth_message_finish(${c.id}, 'sent', null, 'smtp', 'x')`)
    // sent
    expect((await check(a, 'sent')).secret_encrypted).toBeNull()
    await expectHidden(codeA, a.id, 'sent')
    // failed
    const b = await student(); await requestCode(b.email); const codeB = await queuedSecret(b.id)
    provider.sendEmail.mockImplementation(async () => ({ ok: false, provider: 'smtp', error: `550 rejected ${codeB}`, transient: false }))
    await deliverAuthMessages(100)
    expect((await check(b, 'failed')).status).toBe('failed')
    await expectHidden(codeB, b.id, 'failed')
    // skipped
    provider.configured = false
    const c = await student(); await requestCode(c.email); const codeC = await queuedSecret(c.id)
    await deliverAuthMessages(100)
    expect((await check(c, 'skipped')).status).toBe('skipped')
    await expectHidden(codeC, c.id, 'skipped')
    // test
    provider.configured = true; process.env.NOTIFICATIONS_MODE = 'test'
    const d = await student(); await sendVerification(d); const linkD = await queuedSecret(d.id)
    await deliverAuthMessages(100)
    expect((await check(d, 'test')).status).toBe('test')
    await expectHidden(new URL(linkD).searchParams.get('token')!, d.id, 'test')
    // expired
    process.env.NOTIFICATIONS_MODE = 'live'
    const e = await student(); await requestCode(e.email); const codeE = await queuedSecret(e.id)
    await adminSql()`update auth_private.auth_message_outbox set expires_at = now() - interval '1 second' where student_id = ${e.id}`
    await deliverAuthMessages(100)
    expect((await check(e, 'expired')).status).toBe('expired')
    await expectHidden(codeE, e.id, 'expired')
    // revoked (cancelled)
    const f = await student(); const challengeF = await requestCode(f.email); const codeF = await queuedSecret(f.id)
    await adminSql()`update auth_private.portal_challenges set used_at = now() where id = ${challengeF}`
    expect((await check(f, 'revoked')).status).toBe('revoked')
    await expectHidden(codeF, f.id, 'revoked')
    expect(new Set(statuses)).toEqual(new Set(['queued', 'sending', 'sent', 'failed', 'skipped', 'test', 'expired', 'revoked']))
    expect(challengeA).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('managers keep their Messages workflow: a redacted row with status and recipient; no Retry, no text, no secret; GRADUATER sees nothing of Edulinks', async () => {
    const s = await student(); await requestCode(s.email); const code = await queuedSecret(s.id)
    const mgr = await ctxFor('edx.manager@demo.test')
    const rowsSeen = (await notifications.listMessages(mgr, [EDX], { studentId: s.id })).rows.filter((m) => m.event_key === 'portal_login_code')
    expect(rowsSeen).toHaveLength(1)
    expect(rowsSeen[0]).toMatchObject({ redacted: true, status: 'queued', to_address: s.email, subject: null, body: 'Sign-in code – hidden for security' })
    expect(JSON.stringify(rowsSeen)).not.toContain(code)
    // filters work on redacted rows too
    expect((await notifications.listMessages(mgr, [EDX], { studentId: s.id, status: 'sent' })).rows.filter((m) => m.event_key === 'portal_login_code')).toHaveLength(0)
    // company isolation: the GRADUATER manager sees nothing, even when asking for Edulinks explicitly
    const grd = await ctxFor('grd.manager@demo.test')
    expect((await notifications.listMessages(grd, [EDX], { studentId: s.id })).rows).toHaveLength(0)
    expect(await as('grd.manager@demo.test', (tx) => tx`select * from app.auth_message_log(${tx.array([EDX])}::uuid[], ${s.id}, null, null, null, 100)`)).toHaveLength(0)
    // the counsellor (contact details only) sees none, as before
    expect((await notifications.listMessages(await ctxFor('edx.counsellor@demo.test'), [EDX], { studentId: s.id })).rows.filter((m) => m.event_key === 'portal_login_code')).toHaveLength(0)
  })
})

async function sendVerification(s: { mgr: Awaited<ReturnType<typeof ctxFor>>; id: string }) {
  await pp.sendEmailVerification(s.mgr, s.id)
}

describe('N-8: the right student still signs in and verifies the email', () => {
  it('sign-in code: delivered once by the company sender, then wiped; the student signs in; the code is single-use', async () => {
    const s = await student()
    const challenge = await requestCode(s.email)
    const q = await latest(s.id)
    expect(q).toMatchObject({ kind: 'portal_login_code', channel: 'email', status: 'queued', to_address: s.email, challenge_id: challenge })
    expect(q.secret_encrypted).toMatch(/^am1:/)
    await deliverAuthMessages(100)
    const mails = emailsTo(s.email)
    expect(mails).toHaveLength(1)
    expect(mails[0][0]).toBe('EDX')
    const code = codeIn(mails[0][3])!
    expect(mails[0][2]).toContain(code) // the email itself may carry the code in its subject; nothing is stored
    expect(await latest(s.id)).toMatchObject({ status: 'sent', secret_encrypted: null, provider_message_id: 'stub-1' })
    await deliverAuthMessages(100)
    expect(emailsTo(s.email)).toHaveLength(1)
    expect((await verifyCode(challenge, code)).ok).toBe(true)
    expect((await verifyCode(challenge, code)).ok).toBe(false) // replay refused
  })

  it('email verification: the link reaches only the student and verifies the address; single-use', async () => {
    const s = await student()
    await sendVerification(s)
    expect(await latest(s.id)).toMatchObject({ kind: 'email_verification', channel: 'email', status: 'queued' })
    await deliverAuthMessages(100)
    const link = linkIn(emailsTo(s.email)[0][3])!
    const token = new URL(link).searchParams.get('token')!
    await expectHidden(token, s.id, 'verification sent')
    expect(await pp.confirmEmailVerification(token)).toBe('verified')
    expect(await pp.confirmEmailVerification(token)).toBe('invalid')
  })
})

describe('N-8: expiry, revocation and retry never (re)send an invalid secret', () => {
  it('a used code, 5 wrong attempts, or a newer code revoke the queued message at once', async () => {
    const s = await student()
    const c1 = await requestCode(s.email)
    const c2 = await requestCode(s.email) // replaces c1's unsent message
    const [r1, r2] = await rows(s.id)
    expect(r1).toMatchObject({ challenge_id: c1, status: 'revoked', secret_encrypted: null })
    expect(r2).toMatchObject({ challenge_id: c2, status: 'queued' })
    for (let i = 0; i < 5; i++) await anonymous((tx) => tx`select * from app.portal_verify_code(${c2}, ${hmac('000000')}, ${hmac('t' + rand())}, '127.0.0.1', 'test')`)
    expect(await latest(s.id)).toMatchObject({ status: 'revoked', secret_encrypted: null })
    const c3 = await requestCode(s.email); const code3 = await queuedSecret(s.id)
    expect((await verifyCode(c3, code3)).ok).toBe(true) // used before it was even sent
    expect(await latest(s.id)).toMatchObject({ status: 'revoked', secret_encrypted: null })
    await deliverAuthMessages(100)
    expect(emailsTo(s.email)).toHaveLength(0)
  })

  it('an expired code is rejected and never sent; a retry after expiry is never sent', async () => {
    const s = await student()
    const c = await requestCode(s.email); const code = await queuedSecret(s.id)
    provider.sendEmail.mockImplementation(async () => ({ ok: false, provider: 'smtp', error: '421 try later', transient: true }))
    await deliverAuthMessages(100)
    expect(await latest(s.id)).toMatchObject({ status: 'queued', attempts: 1 })
    await adminSql()`update auth_private.portal_challenges set expires_at = now() - interval '1 second' where id = ${c}`
    await makeDue(s.id)
    provider.sendEmail.mockImplementation(async () => ({ ok: true, provider: 'smtp', providerId: 'late' }))
    await deliverAuthMessages(100)
    expect(await latest(s.id)).toMatchObject({ status: 'revoked', secret_encrypted: null })
    expect(emailsTo(s.email)).toHaveLength(1) // only the failed first attempt
    expect((await verifyCode(c, code)).ok).toBe(false)
  })

  it('verification link: replaced, used, expired, or the email changed → revoked / rejected', async () => {
    const s = await student()
    await sendVerification(s); const first = await queuedSecret(s.id)
    await sendVerification(s) // replaces the unsent first link
    const [v1, v2] = await rows(s.id)
    expect(v1).toMatchObject({ status: 'revoked', secret_encrypted: null })
    expect(v2.status).toBe('queued')
    // the email changes while the second link waits → revoked, and the link no longer verifies anything
    const second = await queuedSecret(s.id)
    const st = (await students.getStudent(s.mgr, s.id))!.student
    await students.updateStudent(s.mgr, s.id, { originatingOrgId: EDX, fullName: 'N8 Auth Student', phone: st.phone, email: `changed.${rand()}${rand()}@example.test` })
    expect(await latest(s.id)).toMatchObject({ status: 'revoked', secret_encrypted: null })
    expect(await pp.confirmEmailVerification(new URL(second).searchParams.get('token')!)).toBe('invalid')
    expect(await pp.confirmEmailVerification(new URL(first).searchParams.get('token')!)).toBe('invalid')
    // an expired link before sending is never sent
    const t = await student()
    await sendVerification(t)
    await adminSql()`update auth_private.email_verifications set expires_at = now() - interval '1 second' where student_id = ${t.id}`
    await deliverAuthMessages(100)
    expect(await latest(t.id)).toMatchObject({ status: 'revoked', secret_encrypted: null })
    expect(emailsTo(t.email)).toHaveLength(0)
  })
})

describe('N-8: delivery reliability', () => {
  it('three concurrent senders deliver each message exactly once', async () => {
    const people = await Promise.all(Array.from({ length: 6 }, () => student()))
    for (const p of people) await requestCode(p.email)
    provider.sendEmail.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 20)); return { ok: true, provider: 'smtp', providerId: 'p' } })
    await Promise.all([deliverAuthMessages(), deliverAuthMessages(), deliverAuthMessages()])
    for (const p of people) {
      expect(emailsTo(p.email), p.email).toHaveLength(1)
      expect(await latest(p.id)).toMatchObject({ status: 'sent', secret_encrypted: null })
    }
  })

  it('temporary failure → retry with back-off, secret kept encrypted while pending; after 5 attempts → failed, wiped, audited; permanent failure → failed at once', async () => {
    const s = await student()
    await sendVerification(s)
    provider.sendEmail.mockImplementation(async () => ({ ok: false, provider: 'smtp', error: '421 try later', transient: true }))
    await deliverAuthMessages(100)
    let q = await latest(s.id)
    expect(q).toMatchObject({ status: 'queued', attempts: 1, last_error: '421 try later' })
    expect(q.secret_encrypted).toMatch(/^am1:/)
    expect(new Date(q.next_attempt_at).getTime()).toBeGreaterThan(Date.now())
    for (let i = 0; i < 6; i++) { await makeDue(s.id); await deliverAuthMessages(100) }
    q = await latest(s.id)
    expect(q).toMatchObject({ status: 'failed', attempts: 5, secret_encrypted: null })
    expect(emailsTo(s.email)).toHaveLength(5)
    const [a] = await adminSql()`select outcome, org_id, student_id, metadata from audit_logs where action = 'auth_message_failed' and student_id = ${s.id}`
    expect(a).toMatchObject({ outcome: 'failure', org_id: EDX, student_id: s.id })
    const p = await student()
    provider.sendEmail.mockImplementation(async () => ({ ok: false, provider: 'smtp', error: '550 no such user', transient: false }))
    await requestCode(p.email)
    await deliverAuthMessages(100)
    expect(await latest(p.id)).toMatchObject({ status: 'failed', attempts: 1, secret_encrypted: null })
  })
})

describe('N-8: WhatsApp (Gallabox) request handling', () => {
  it('the code goes to Gallabox only in the request body; an error that echoes the request is stored masked, never with the code', async () => {
    process.env.GALLABOX_API_KEY = 'test-key'; process.env.GALLABOX_API_SECRET = 'test-secret'; process.env.GALLABOX_CHANNEL_ID = 'test-channel'
    const [tpl] = await adminSql()`select id, provider_template_name from notification_templates where org_id = ${EDX} and name = 'Portal sign-in code' and channel = 'whatsapp'`
    await adminSql()`update notification_templates set provider_template_name = 'portal_code_test' where id = ${tpl.id}`
    try {
      const sent: string[] = []
      const fetchStub = vi.fn(async (_url: string, init: { body: string }) => { sent.push(init.body); return new Response(`{"error":"bad request","echo":${init.body}}`, { status: 400 }) })
      vi.stubGlobal('fetch', fetchStub)
      const s = await student(uniquePhone())
      await requestCode(s.phone)
      const q = await latest(s.id)
      expect(q).toMatchObject({ channel: 'whatsapp', status: 'queued' })
      const code = await queuedSecret(s.id)
      await deliverAuthMessages(100)
      expect(fetchStub).toHaveBeenCalledTimes(1)
      const body = JSON.parse(sent[0])
      expect(body.whatsapp.template).toMatchObject({ templateName: 'portal_code_test', bodyValues: { code } })
      const after = await latest(s.id)
      expect(after).toMatchObject({ status: 'failed', secret_encrypted: null, provider: 'gallabox' })
      expect(after.last_error).toMatch(/^HTTP 400/)
      expect(after.last_error).not.toContain(code)
      await expectHidden(code, s.id, 'whatsapp error')
      // a temporary Gallabox failure keeps the (encrypted) code for a retry, again with a masked error
      fetchStub.mockImplementation(async (_u: string, init: { body: string }) => new Response(`overloaded ${init.body}`, { status: 503 }))
      const t = await student(uniquePhone())
      await requestCode(t.phone); const codeT = await queuedSecret(t.id)
      await deliverAuthMessages(100)
      const r = await latest(t.id)
      expect(r).toMatchObject({ status: 'queued', attempts: 1 })
      expect(r.last_error).not.toContain(codeT)
    } finally {
      await adminSql()`update notification_templates set provider_template_name = ${tpl.provider_template_name} where id = ${tpl.id}`
    }
  })

  it('masking removes the secret, any 4+ digit run and tokens from error text', () => {
    expect(maskSecretText('code 123456 in token=abcDEF_123 and 0987654321', '123456')).toBe('code •••• in token=•••• and ••••')
  })
})

describe('N-8: test mode and the local test mailbox', () => {
  const mailboxFiles = () => (existsSync(TEST_MAILBOX_DIR) ? readdirSync(TEST_MAILBOX_DIR) : [])

  it('test mode: nothing sent, nothing stored, the secret wiped; allow-listed recipients still receive the message', async () => {
    process.env.NOTIFICATIONS_MODE = 'test'
    delete process.env.NOTIFICATIONS_TEST_MAILBOX
    const before = mailboxFiles()
    const s = await student(); await requestCode(s.email); const code = await queuedSecret(s.id)
    await deliverAuthMessages(100)
    expect(await latest(s.id)).toMatchObject({ status: 'test', secret_encrypted: null, last_error: 'Test mode: not sent' })
    expect(provider.sendEmail).not.toHaveBeenCalled()
    expect(mailboxFiles()).toEqual(before) // mailbox off by default
    await expectHidden(code, s.id, 'test mode')
    const t = await student()
    process.env.NOTIFICATIONS_TEST_RECIPIENTS = t.email
    await requestCode(t.email)
    await deliverAuthMessages(100)
    expect(emailsTo(t.email)).toHaveLength(1)
    expect(await latest(t.id)).toMatchObject({ status: 'sent', secret_encrypted: null })
  })

  it('with NOTIFICATIONS_TEST_MAILBOX=1 outside production the message goes to a private local file, never to the database or staff', async () => {
    process.env.NOTIFICATIONS_MODE = 'test'
    process.env.NOTIFICATIONS_TEST_MAILBOX = '1'
    const before = new Set(mailboxFiles())
    const s = await student(); const challenge = await requestCode(s.email)
    await deliverAuthMessages(100)
    const created = mailboxFiles().filter((f) => !before.has(f))
    try {
      expect(created).toHaveLength(1)
      const file = path.join(TEST_MAILBOX_DIR, created[0])
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(statSync(TEST_MAILBOX_DIR).mode & 0o777).toBe(0o700)
      const m = JSON.parse(readFileSync(file, 'utf8'))
      expect(m).toMatchObject({ kind: 'portal_login_code', channel: 'email', to: s.email })
      const code = codeIn(m.body)!
      expect(await latest(s.id)).toMatchObject({ status: 'test', secret_encrypted: null, last_error: 'Test mode: not sent (local test mailbox)' })
      await expectHidden(code, s.id, 'mailbox')
      expect((await verifyCode(challenge, code)).ok).toBe(true)
    } finally {
      for (const f of created) rmSync(path.join(TEST_MAILBOX_DIR, f), { force: true })
    }
  })
})

describe('N-8: direct access, server-side decryption and API responses', () => {
  it('the application role and every staff login are refused on the queue; sender functions refuse staff contexts', async () => {
    await expectDbError(db()`select * from auth_private.auth_message_outbox limit 1`, '42501')
    for (const email of ['md@demo.test', 'ceo@demo.test', 'admin@demo.test', 'edx.manager@demo.test']) {
      await expectDbError(as(email, (tx) => tx`select * from auth_private.auth_message_outbox limit 1`), '42501')
      await expectDbError(as(email, (tx) => tx`select * from app.auth_message_claim(10)`), '42501')
      await expectDbError(as(email, (tx) => tx`select app.auth_message_finish(gen_random_uuid(), 'sent', null, null, null)`), '42501')
      await expectDbError(as(email, (tx) => tx`select app.auth_message_housekeeping()`), '42501')
    }
  })

  it('authenticated decryption: tampered, truncated, wrong-kind and N-1/N-7-key cipher texts are rejected; the sender fails them safely', async () => {
    const good = encryptAuthSecret('portal_login_code', '123456')
    expect(decryptAuthSecret('portal_login_code', good)).toBe('123456')
    const [v, iv, tag, ct] = good.split(':')
    const flip = (b64: string) => { const b = Buffer.from(b64, 'base64'); b[0] ^= 1; return b.toString('base64') }
    for (const bad of [`${v}:${iv}:${tag}:${flip(ct)}`, `${v}:${iv}:${flip(tag)}:${ct}`, `${v}:${flip(iv)}:${tag}:${ct}`, `${v}:${iv}:${tag}`, 'am1:x:y:z', '',
      encryptSecret('123456'), `am1:${encryptSecret('123456').slice(3)}`]) {
      expect(() => decryptAuthSecret('portal_login_code', bad)).toThrow()
    }
    expect(() => decryptAuthSecret('email_verification', good)).toThrow() // bound to its kind
    // a well-formed but unauthenticated cipher text in the queue: the sender marks it failed, sends nothing, wipes it
    const s = await student(); await requestCode(s.email)
    await adminSql()`update auth_private.auth_message_outbox set secret_encrypted = ${`${v}:${iv}:${tag}:${flip(ct)}`} where student_id = ${s.id}`
    await deliverAuthMessages(100)
    expect(await latest(s.id)).toMatchObject({ status: 'failed', secret_encrypted: null, last_error: 'The stored secret could not be read.' })
    expect(emailsTo(s.email)).toHaveLength(0)
  })

  it('the cron API response contains counts only, never a secret', async () => {
    process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789'
    const s = await student(); await requestCode(s.email); const code = await queuedSecret(s.id)
    const res = await cronNotifications(new Request('http://localhost/api/cron/notifications', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(code)
    expect(JSON.parse(text).authMessages).toMatchObject({ sent: expect.any(Number) })
    expect(await latest(s.id)).toMatchObject({ status: 'sent', secret_encrypted: null })
  })
})
