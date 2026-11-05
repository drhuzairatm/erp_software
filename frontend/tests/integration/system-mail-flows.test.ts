/**
 * Contracts of the existing system-email flows now that they use SMTP: staff invitations, staff password resets and
 * security alerts. Real actions, services and queues on the throwaway test database; Nodemailer is mocked, so nothing
 * connects to a server and no email is sent. Fictional accounts and settings only; links are never printed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest-system-mail' }), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => {} }))
const session = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/lib/auth/session', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/session')>()), requireUser: async () => session.ctx }))
const mail = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: mail.createTransport } }))

import { createStaffAction, inviteAction } from '@/app/actions/admin'
import type { ActionResult } from '@/components/action-types'
import { requestPasswordReset } from '@/lib/auth/passwords'
import { deliverStaffEmails } from '@/lib/auth/staff-email'
import { db } from '@/lib/db'
import { emailSecurityAlerts } from '@/lib/security/jobs'
import { adminSql, ctxFor, orgId } from '../../../backend/tests/support/helpers'

const INITIAL = { ok: false, message: '' } as ActionResult
const FROM = 'no-reply@example.test'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
const configure = () => {
  vi.stubEnv('NOTIFICATIONS_MODE', 'live') // delivery tests; test mode is covered in backend/tests/unit/system-mail.test.ts
  vi.stubEnv('SYSTEM_MAIL_HOST', 'smtp.example.test')
  vi.stubEnv('SYSTEM_MAIL_PORT', '587')
  vi.stubEnv('SYSTEM_MAIL_FROM_EMAIL', FROM)
  vi.stubEnv('SYSTEM_MAIL_USER', 'mailer@example.test')
  vi.stubEnv('SYSTEM_MAIL_PASSWORD', 'fictional-smtp-password-value')
}
const smtpFailure = (status: number) => Object.assign(new Error('fictional provider text'), { responseCode: status })

let EDX: string
let counsellorRole: string

function newStaffForm() {
  const n = rand()
  const email = `mailflow.${n}@example.test`
  const fd = new FormData()
  for (const [k, v] of Object.entries({ email, fullName: `Mail Flow ${n}`, orgId: EDX, roleId: counsellorRole })) fd.append(k, v)
  return { email, fd }
}

beforeAll(async () => {
  EDX = await orgId('EDX')
  ;[{ id: counsellorRole }] = await adminSql()`select id from roles where org_id = ${EDX} and key = 'counsellor'`
  session.ctx = await ctxFor('md@demo.test')
})
beforeEach(() => {
  mail.sendMail.mockReset().mockResolvedValue({ messageId: 'fictional' })
  mail.createTransport.mockReset().mockReturnValue({ sendMail: mail.sendMail })
})
afterEach(() => { vi.unstubAllEnvs() })
afterAll(async () => { await adminSql().end(); await db().end() })

describe('staff invitations', () => {
  it('not configured: the account is created and the one-time link is returned to the administrator; nothing is sent', async () => {
    const { fd } = newStaffForm()
    const r = await createStaffAction(INITIAL, fd)
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/^Account created\. Email is not configured, so give this one-time invitation link to the person securely \(valid until .+\):$/)
    expect((r.data as { link: string }).link).toMatch(/^http:\/\/localhost:3000\/invite\//)
    expect(mail.createTransport).not.toHaveBeenCalled()
  })

  it('configured: the invitation goes to the person with the same subject and text, and no link goes to the administrator', async () => {
    configure()
    const { email, fd } = newStaffForm()
    const r = await createStaffAction(INITIAL, fd)
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/^Account created and an invitation was emailed \(valid until .+\)\.$/)
    expect(r.data).toBeUndefined()
    expect(mail.sendMail).toHaveBeenCalledOnce()
    const m = mail.sendMail.mock.calls[0][0]
    expect(m).toMatchObject({ from: FROM, to: email, subject: 'Your staff account invitation' })
    expect(m.text).toMatch(/^Hello Mail Flow \d+,\n\nAn account has been created for you on the Dr\.Expert Edulinks \/ GRADUATER staff portal\.\n\nOpen this link to create your private password and activate your account \(valid until .+\):\nhttp:\/\/localhost:3000\/invite\/\S+\n\nIf you were not expecting this, ignore this email\.$/)
  })

  it('provider failure: one attempt only, and the administrator still receives the one-time link', async () => {
    configure()
    mail.sendMail.mockRejectedValueOnce(smtpFailure(550))
    const { fd } = newStaffForm()
    const r = await createStaffAction(INITIAL, fd)
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/^Account created\. Email is not configured/)
    expect((r.data as { link: string }).link).toContain('/invite/')
    expect(mail.sendMail).toHaveBeenCalledOnce()
  })

  it('a new invitation is emailed through the same path; earlier links stop working', async () => {
    const { email, fd } = newStaffForm()
    await createStaffAction(INITIAL, fd)
    const [u] = await adminSql()`select id from user_profiles where email = ${email}`
    configure()
    const r = await inviteAction(u.id, INITIAL)
    expect(r.message).toMatch(/^Invitation emailed \(valid until .+\)\. Earlier links no longer work\.$/)
    expect(r.data).toBeUndefined()
    expect(mail.sendMail.mock.calls[0][0]).toMatchObject({ from: FROM, to: email, subject: 'Your staff account invitation' })
  })
})

describe('staff password reset queue', () => {
  beforeEach(async () => {
    await adminSql()`update auth_private.staff_email_outbox set status = 'skipped', link_encrypted = null, finished_at = now() where status in ('queued', 'sending')`
  })
  /** An active fictional account (the seed) with no recent reset requests, so the limits never apply. */
  async function queuedReset() {
    const [{ email, id }] = await adminSql()`select email, id from user_profiles where email = 'edx.counsellor@demo.test'`
    await adminSql()`delete from auth_private.password_reset_requests where lower(email) = ${email}`
    await adminSql()`delete from auth_private.staff_email_outbox where user_id = ${id}`
    await requestPasswordReset(email)
    return { email, id: id as string }
  }
  const row = async (id: string) => (await adminSql()`select status, attempts, last_error, link_encrypted from auth_private.staff_email_outbox where user_id = ${id} order by created_at desc limit 1`)[0]

  it('delivers once with the same subject and text, then wipes the link', async () => {
    configure()
    const { email, id } = await queuedReset()
    expect(await deliverStaffEmails()).toMatchObject({ sent: 1 })
    expect(mail.sendMail).toHaveBeenCalledOnce()
    const m = mail.sendMail.mock.calls[0][0]
    expect(m).toMatchObject({ from: FROM, to: email, subject: 'Reset your password' })
    expect(m.text).toMatch(/^Hello .+,\n\nUse this link within 1 hour to set a new password:\nhttp:\/\/localhost:3000\/reset-password\/\S+\n\nIf you did not ask for this, ignore this email\.$/)
    expect(await row(id)).toMatchObject({ status: 'sent', link_encrypted: null })
  })

  it('a provider failure stays queued for the existing retry, storing only the status text', async () => {
    configure()
    mail.sendMail.mockRejectedValueOnce(smtpFailure(451))
    const { id } = await queuedReset()
    expect(await deliverStaffEmails()).toMatchObject({ retry: 1 })
    const r = await row(id)
    expect(r).toMatchObject({ status: 'queued', attempts: 1, last_error: 'Email provider returned 451' })
    expect(r.link_encrypted).toMatch(/^v1:/)
  })

  it('not configured: recorded as skipped and the link wiped, as before', async () => {
    const { id } = await queuedReset()
    expect(await deliverStaffEmails()).toMatchObject({ skipped: 1 })
    expect(mail.createTransport).not.toHaveBeenCalled()
    expect(await row(id)).toMatchObject({ status: 'skipped', link_encrypted: null })
  })
})

describe('security alerts', () => {
  const emailedAt = async (title: string) => (await adminSql()`select emailed_at from security_alerts where title = ${title}`)[0].emailed_at
  async function newAlert() {
    // only the new alert is pending, so the batch limit cannot hide it
    await adminSql()`update security_alerts set emailed_at = now() where emailed_at is null`
    const title = `Fictional mail flow alert ${rand()}`
    await adminSql()`select app.raise_security_alert('fictional_mail_flow', 'critical', ${title}, ${`mailflow:${rand()}`}, '{}'::jsonb, null, null)`
    return title
  }

  it('not configured: nothing is sent and the alert stays pending', async () => {
    const title = await newAlert()
    expect(await emailSecurityAlerts()).toEqual({ emailed: 0, reason: 'email not configured' })
    expect(mail.createTransport).not.toHaveBeenCalled()
    expect(await emailedAt(title)).toBeNull()
  })

  it('configured: every recipient gets the same subject and text, then the alert is marked as emailed', async () => {
    configure()
    const title = await newAlert()
    expect(await emailSecurityAlerts()).toEqual({ emailed: 1 })
    expect(mail.sendMail).toHaveBeenCalled()
    for (const [m] of mail.sendMail.mock.calls) {
      expect(m).toMatchObject({ from: FROM, subject: `[Security critical] ${title}` })
      expect(m.text).toBe(`A critical security alert was raised in the staff portal:\n\n${title}\n\nReview it (sign-in required): http://localhost:3000/admin/security\n\nNo personal details are included in this email.`)
    }
    expect(await emailedAt(title)).not.toBeNull()
  })

  it('if nobody could be reached, the alert stays pending and is retried on the next run', async () => {
    configure()
    const title = await newAlert()
    mail.sendMail.mockRejectedValue(smtpFailure(451))
    expect(await emailSecurityAlerts()).toEqual({ emailed: 0 })
    expect(await emailedAt(title)).toBeNull()
    mail.sendMail.mockReset().mockResolvedValue({ messageId: 'fictional' })
    expect(await emailSecurityAlerts()).toEqual({ emailed: 1 })
    expect(await emailedAt(title)).not.toBeNull()
  })
})
