/** Security alert emails and staff reset emails, with the real test-mode rules. No server is contacted. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mail = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mail.send }) } }))
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))

import { acceptInvitation, requestPasswordReset } from '@/lib/auth/passwords'
import { deliverStaffEmails } from '@/lib/auth/staff-email'
import { db } from '@/lib/db'
import { emailSecurityAlerts } from '@/lib/security/jobs'
import * as admin from '@/services/admin'
import { adminSql, ctxFor, delegateToSystemAdmin, orgId } from '../support/helpers'

const SMTP = { SYSTEM_MAIL_HOST: 'smtp.example.test', SYSTEM_MAIL_PORT: '587', SYSTEM_MAIL_FROM_EMAIL: 'no-reply@example.test', SYSTEM_MAIL_USER: 'mailer', SYSTEM_MAIL_PASSWORD: 'fictional' }
const clearPending = async () => {
  await adminSql()`update security_alerts set emailed_at = now() where emailed_at is null`
  await adminSql()`update auth_private.staff_email_outbox set status = 'skipped', link_encrypted = null, finished_at = now() where status in ('queued', 'sending')`
}
const newAlert = async () => {
  const [a] = await adminSql()`insert into security_alerts (kind, severity, title) values ('test_alert', 'high', 'Fictional test alert') returning id`
  return a.id as string
}
const emailedAt = async (id: string) => (await adminSql()`select emailed_at from security_alerts where id = ${id}`)[0].emailed_at
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
async function staff() {
  const edx = await orgId('EDX')
  const [role] = await adminSql()`select id from roles where org_id = ${edx} and key = 'counsellor'`
  const email = `system-email.${rand()}@example.test`
  const r = await admin.createStaff(await ctxFor('md@demo.test'), { email, fullName: `System Email ${rand()}`, orgId: edx, roleId: role.id })
  await acceptInvitation(r.setupPath!.split('/').pop()!, 'Fictional-Outbox-Pass1!', 'Fictional-Outbox-Pass1!')
  const [u] = await adminSql()`select id from user_profiles where email = ${email}`
  return { email, id: u.id as string }
}
const recipients = (to: string) => mail.send.mock.calls.filter((c) => c[0].to === to).length

beforeAll(async () => { await delegateToSystemAdmin(['security.alerts']) }) // a second holder, so an alert has several recipients (test setup)
beforeEach(async () => {
  mail.send.mockReset().mockResolvedValue({ messageId: 'fictional' })
  for (const [k, v] of Object.entries(SMTP)) vi.stubEnv(k, v)
  vi.stubEnv('NOTIFICATIONS_MODE', 'live')
  await clearPending()
})
afterEach(async () => { vi.unstubAllEnvs(); await clearPending() })
afterAll(async () => {
  // this delegation is for this file only: other test files assert who holds security.alerts
  await adminSql()`delete from role_permissions where permission_key = 'security.alerts' and role_id in (select id from roles where key = 'system_admin')`
  await adminSql().end(); await db().end()
})

describe('security alert email', () => {
  it('one failing recipient does not re-send the alert to the others on every run', async () => {
    const id = await newAlert()
    const [{ recipients: all }] = await adminSql()`select recipients from app.security_alerts_to_email() where alert_id = ${id}`
    expect(all.length).toBeGreaterThanOrEqual(2)
    const [bad, good] = all as string[]
    mail.send.mockImplementation(async (m: { to: string }) => {
      if (m.to === bad) throw Object.assign(new Error('rejected'), { responseCode: 550 })
      return { messageId: 'fictional' }
    })
    await emailSecurityAlerts()
    await emailSecurityAlerts()
    await emailSecurityAlerts()
    expect(recipients(good)).toBe(1)
    expect(await emailedAt(id)).not.toBeNull()
  })

  it('stays pending and is retried when nobody could be reached', async () => {
    const id = await newAlert()
    mail.send.mockRejectedValue(Object.assign(new Error('down'), { code: 'ECONNECTION' }))
    await emailSecurityAlerts()
    expect(await emailedAt(id)).toBeNull()
    mail.send.mockReset().mockResolvedValue({ messageId: 'fictional' })
    await emailSecurityAlerts()
    expect(await emailedAt(id)).not.toBeNull()
  })

  it('test mode: no email is sent, and the alert stays pending', async () => {
    vi.stubEnv('NOTIFICATIONS_MODE', 'test')
    vi.stubEnv('NOTIFICATIONS_TEST_RECIPIENTS', '')
    const id = await newAlert()
    await emailSecurityAlerts()
    expect(mail.send).not.toHaveBeenCalled()
    expect(await emailedAt(id)).toBeNull()
  })
})

describe('staff password reset email', () => {
  const queued = async (uid: string) => (await adminSql()`select status, link_encrypted, last_error from auth_private.staff_email_outbox where user_id = ${uid} order by created_at desc limit 1`)[0]

  it('test mode: nothing is sent, not retried, and the link is wiped at once', async () => {
    vi.stubEnv('NOTIFICATIONS_MODE', 'test')
    vi.stubEnv('NOTIFICATIONS_TEST_RECIPIENTS', '')
    const v = await staff()
    await requestPasswordReset(v.email)
    expect(await deliverStaffEmails()).toMatchObject({ sent: 0, retry: 0, skipped: 1 })
    expect(mail.send).not.toHaveBeenCalled()
    expect(await queued(v.id)).toMatchObject({ status: 'skipped', link_encrypted: null, last_error: 'Test mode: not sent' })
  })

  it('live mode: delivered once', async () => {
    const v = await staff()
    await requestPasswordReset(v.email)
    expect(await deliverStaffEmails()).toMatchObject({ sent: 1 })
    expect(recipients(v.email)).toBe(1)
  })
})
