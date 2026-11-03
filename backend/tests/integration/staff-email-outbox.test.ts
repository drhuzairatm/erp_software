/**
 * Finding N-1: the dedicated, durable staff email queue for password-reset links (auth_private.staff_email_outbox).
 * The email provider is replaced by a stub; nothing leaves the machine. Fictional accounts only; links are never printed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const currentHeaders = new Headers()
vi.mock('next/headers', () => ({ headers: async () => currentHeaders, cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))
let configured = true
const sendEmail = vi.fn(async (_to: string, _subject: string, _text: string) => ({ sent: true } as { sent: boolean; error?: string }))
vi.mock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), emailConfigured: () => configured, sendEmail: (to: string, s: string, t: string) => sendEmail(to, s, t) }))

import { decryptSecret } from '@/lib/auth/mfa'
import { acceptInvitation, requestPasswordReset } from '@/lib/auth/passwords'
import { deliverStaffEmails } from '@/lib/auth/staff-email'
import { hashToken } from '@/lib/auth/tokens'
import { anonymous, db } from '@/lib/db'
import * as admin from '@/services/admin'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../support/helpers'

const PW = 'Fictional-Outbox-Pass1!'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
let EDX: string
beforeAll(async () => { EDX = await orgId('EDX') })
beforeEach(async () => {
  configured = true; sendEmail.mockReset(); sendEmail.mockImplementation(async () => ({ sent: true }))
  // isolate each test from messages queued by earlier tests
  await adminSql()`update auth_private.staff_email_outbox set status = 'skipped', link_encrypted = null, finished_at = now() where status in ('queued', 'sending')`
})
afterAll(async () => { await adminSql().end(); await db().end() })

async function staff() {
  const md = await ctxFor('md@demo.test')
  const [role] = await adminSql()`select id from roles where org_id = ${EDX} and key = 'counsellor'`
  const email = `outbox.${rand()}@example.test`
  const r = await admin.createStaff(md, { email, fullName: `Outbox Test ${rand()}`, orgId: EDX, roleId: role.id })
  await acceptInvitation(r.setupPath!.split('/').pop()!, PW, PW)
  const [u] = await adminSql()`select id from user_profiles where email = ${email}`
  return { email, id: u.id as string }
}
const row = async (uid: string) => (await adminSql()`select * from auth_private.staff_email_outbox where user_id = ${uid} order by created_at desc limit 1`)[0]
const makeDue = (uid: string) => adminSql()`update auth_private.staff_email_outbox set next_attempt_at = now() where user_id = ${uid}`

describe('staff email queue: encryption and delivery', () => {
  it('the link is stored encrypted (never the token), delivered once, then wiped; the token hash matches the reset record', async () => {
    const v = await staff()
    await requestPasswordReset(v.email)
    const q = await row(v.id)
    expect(q).toMatchObject({ status: 'queued', kind: 'password_reset', to_address: v.email, attempts: 0 })
    expect(q.link_encrypted).toMatch(/^v1:/)
    const link = decryptSecret(q.link_encrypted)
    const token = link.split('/').pop()!
    expect(q.link_encrypted).not.toContain(token)
    const [r] = await adminSql()`select count(*)::int as n from auth_private.password_resets where token_hash = ${hashToken(token)} and used_at is null`
    expect(r.n).toBe(1)
    const s = await deliverStaffEmails()
    expect(s.sent).toBeGreaterThanOrEqual(1)
    const mine = sendEmail.mock.calls.filter((c) => c[0] === v.email)
    expect(mine).toHaveLength(1)
    expect(mine[0][2]).toContain(link)
    const after = await row(v.id)
    expect(after).toMatchObject({ status: 'sent', link_encrypted: null, attempts: 1 })
    expect(after.finished_at).not.toBeNull()
    await deliverStaffEmails()
    expect(sendEmail.mock.calls.filter((c) => c[0] === v.email)).toHaveLength(1) // never sent twice
  })

  it('provider failure: retried with back-off, link kept encrypted while pending; after 5 attempts → failed, link wiped, audited and alerted', async () => {
    const v = await staff()
    sendEmail.mockImplementation(async () => ({ sent: false, error: 'Email provider returned 503' }))
    await requestPasswordReset(v.email)
    await deliverStaffEmails()
    let q = await row(v.id)
    expect(q).toMatchObject({ status: 'queued', attempts: 1, last_error: 'Email provider returned 503' })
    expect(q.link_encrypted).toMatch(/^v1:/)
    expect(new Date(q.next_attempt_at).getTime()).toBeGreaterThan(Date.now())
    for (let i = 0; i < 6; i++) { await makeDue(v.id); await deliverStaffEmails() }
    q = await row(v.id)
    expect(q).toMatchObject({ status: 'failed', attempts: 5, link_encrypted: null })
    expect(sendEmail.mock.calls.filter((c) => c[0] === v.email)).toHaveLength(5)
    const [a] = await adminSql()`select outcome, metadata from audit_logs where action = 'password_reset_email_failed' and entity_id = ${v.id}`
    expect(a.outcome).toBe('failure')
    const [al] = await adminSql()`select severity, details from security_alerts where kind = 'password_reset_email_failed' and subject_key = ${'user:' + v.id}`
    expect(al.severity).toBe('warning')
    expect(JSON.stringify([a, al])).not.toMatch(/reset-password|token=/)
  })

  it('email not configured: the message is skipped and the link wiped immediately (an administrator issues a link instead)', async () => {
    const v = await staff()
    configured = false
    await requestPasswordReset(v.email)
    await deliverStaffEmails()
    expect(await row(v.id)).toMatchObject({ status: 'skipped', link_encrypted: null, last_error: 'Email delivery is not configured.' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('expired before delivery: marked expired and the link wiped, never sent', async () => {
    const v = await staff()
    await requestPasswordReset(v.email)
    await adminSql()`update auth_private.staff_email_outbox set expires_at = now() - interval '1 second' where user_id = ${v.id}`
    await deliverStaffEmails()
    expect(await row(v.id)).toMatchObject({ status: 'expired', link_encrypted: null })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('duplicate prevention: two senders running at the same time deliver each message exactly once', async () => {
    const people = await Promise.all(Array.from({ length: 6 }, () => staff()))
    for (const p of people) await requestPasswordReset(p.email)
    sendEmail.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 20)); return { sent: true } })
    await Promise.all([deliverStaffEmails(), deliverStaffEmails(), deliverStaffEmails()])
    for (const p of people) {
      expect(sendEmail.mock.calls.filter((c) => c[0] === p.email), p.email).toHaveLength(1)
      expect(await row(p.id)).toMatchObject({ status: 'sent', link_encrypted: null })
    }
  })

  it('the database refuses a pending link in a final state (CHECK constraint)', async () => {
    const v = await staff()
    await requestPasswordReset(v.email)
    await expectDbError(adminSql()`update auth_private.staff_email_outbox set status = 'sent' where user_id = ${v.id}`, '23514')
    await expectDbError(adminSql()`update auth_private.staff_email_outbox set link_encrypted = 'plain https://x/reset-password/abc' where user_id = ${v.id}`, '23514')
    await expectDbError(anonymous((tx) => tx`select app.auth_request_reset_limited(${v.email}, null, ${'f'.repeat(64)}, 'https://plain-link')`), '22023')
  })

  it('system-wide cap: at 100 reset emails in an hour, further requests are limited and a HIGH alert is raised', async () => {
    const filler = await staff(); const v = await staff()
    await adminSql()`insert into auth_private.staff_email_outbox (user_id, kind, to_address, status, expires_at, finished_at)
                     select ${filler.id}, 'password_reset', ${filler.email}, 'sent', now() + interval '1 hour', now() from generate_series(1, 100)`
    await requestPasswordReset(v.email)
    const [r] = await adminSql()`select outcome from auth_private.password_reset_requests where email = ${v.email}`
    expect(r.outcome).toBe('limited_global')
    expect(await row(v.id)).toBeUndefined()
    const [al] = await adminSql()`select severity from security_alerts where kind = 'password_reset_limited' and subject_key = 'global'`
    expect(al.severity).toBe('high')
    await adminSql()`delete from auth_private.staff_email_outbox where user_id = ${filler.id}`
  })
})

describe('staff email queue: nobody can read another employee\'s reset link (including the MD\'s)', () => {
  it('the application role cannot read the queue, the reset log or the trusted-browser table', async () => {
    for (const t of ['staff_email_outbox', 'password_reset_requests', 'trusted_devices', 'password_resets']) {
      await expectDbError(db().unsafe(`select * from auth_private.${t} limit 1`), '42501')
    }
  })

  it('sender functions refuse any signed-in staff context, even the MD', async () => {
    for (const email of ['md@demo.test', 'admin@demo.test', 'edx.manager@demo.test']) {
      await expectDbError(as(email, (tx) => tx`select * from app.staff_email_claim(10)`), '42501')
      await expectDbError(as(email, (tx) => tx`select app.staff_email_finish(gen_random_uuid(), 'sent', null)`), '42501')
      await expectDbError(as(email, (tx) => tx`select app.auth_housekeeping()`), '42501')
    }
  })

  it('the MD\'s reset link appears nowhere staff can look: outbox, audit log, security alerts, notification outbox', async () => {
    const [md] = await adminSql()`select id, email from user_profiles where email = 'md@demo.test'`
    await adminSql()`delete from auth_private.password_reset_requests where email = ${md.email}` // fresh limits for this check
    await requestPasswordReset(md.email)
    const q = await row(md.id)
    const token = decryptSecret(q.link_encrypted).split('/').pop()!
    // what staff with the widest permissions can read, as themselves
    for (const email of ['md@demo.test', 'admin@demo.test']) {
      const seen = await as(email, async (tx) => JSON.stringify([
        await tx`select * from audit_logs order by id desc limit 200`,
        await tx`select * from security_alerts`.catch(() => []),
        await tx`select * from notification_messages order by created_at desc limit 200`.catch(() => []),
      ]))
      expect(seen).not.toContain(token)
      expect(seen).not.toContain('/reset-password/')
    }
    const everything = JSON.stringify(await adminSql()`select (select json_agg(a) from (select * from audit_logs order by id desc limit 500) a) as a,
      (select json_agg(s) from security_alerts s) as s, (select json_agg(m) from notification_messages m) as m`)
    expect(everything).not.toContain(token)
    // MD's sign-in is not affected by the request
    const [{ n }] = await adminSql()`select count(*)::int as n from auth_private.login_attempts where email = ${md.email} and not success and attempted_at > now() - interval '15 minutes'`
    expect(n).toBe(0)
    // clean up: wipe the MD's pending link and invalidate the token (fictional test database only)
    await adminSql()`update auth_private.staff_email_outbox set status = 'skipped', link_encrypted = null, finished_at = now() where user_id = ${md.id} and status = 'queued'`
    await adminSql()`update auth_private.password_resets set used_at = now() where user_id = ${md.id} and used_at is null`
  })
})
