/**
 * System email over SMTP (backend/src/lib/email.ts). Nodemailer is fully mocked: nothing connects to a server and no
 * email is sent. All settings are fictional. Also checks that per-company student/parent SMTP stays separate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mail = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: mail.createTransport } }))

import { emailConfigured, sendEmail } from '../../src/lib/email'
import { channelConfigured, sendEmail as sendBrandEmail } from '../../src/lib/notifications/providers'

const PASSWORD = 'fictional-smtp-password-value'
const VALID = {
  SYSTEM_MAIL_HOST: 'smtp.example.test',
  SYSTEM_MAIL_PORT: '587',
  SYSTEM_MAIL_FROM_EMAIL: 'no-reply@example.test',
  SYSTEM_MAIL_USER: 'mailer@example.test',
  SYSTEM_MAIL_PASSWORD: PASSWORD,
}
const configure = (values: Partial<typeof VALID> = {}) => { for (const [k, v] of Object.entries({ ...VALID, ...values })) vi.stubEnv(k, v) }
const lastTransportOptions = () => mail.createTransport.mock.calls.at(-1)![0]

beforeEach(() => {
  mail.sendMail.mockReset().mockResolvedValue({ messageId: 'fictional' })
  mail.createTransport.mockReset().mockReturnValue({ sendMail: mail.sendMail })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('configuration', () => {
  it('is configured only when every setting is present and valid', () => {
    expect(emailConfigured()).toBe(false)
    configure()
    expect(emailConfigured()).toBe(true)
  })

  it.each(Object.keys(VALID))('partial configuration (%s empty) counts as not configured and sends nothing', async (name) => {
    configure({ [name]: '' })
    expect(emailConfigured()).toBe(false)
    expect(await sendEmail('person@example.test', 'Subject', 'Body')).toEqual({ sent: false, error: 'Email delivery is not configured.' })
    expect(mail.createTransport).not.toHaveBeenCalled()
  })

  it.each([
    ['a port other than 465 or 587', { SYSTEM_MAIL_PORT: '25' }],
    ['a non-numeric port', { SYSTEM_MAIL_PORT: 'abc' }],
    ['a host given as a URL', { SYSTEM_MAIL_HOST: 'smtps://user:secret@smtp.example.test' }],
    ['a sender with a line break', { SYSTEM_MAIL_FROM_EMAIL: 'a@example.test\r\nBcc: b@example.test' }],
    ['more than one sender', { SYSTEM_MAIL_FROM_EMAIL: 'a@example.test,b@example.test' }],
    ['a malformed sender', { SYSTEM_MAIL_FROM_EMAIL: 'not-an-address' }],
  ])('%s counts as not configured', (_label, values) => {
    configure(values)
    expect(emailConfigured()).toBe(false)
  })
})

describe('TLS and timeouts', () => {
  it('port 587 requires STARTTLS, with verified certificates, TLS 1.2+ and timeouts', async () => {
    configure({ SYSTEM_MAIL_HOST: 'smtp587.example.test', SYSTEM_MAIL_PORT: '587' })
    expect(await sendEmail('person@example.test', 'Subject', 'Body')).toEqual({ sent: true })
    expect(lastTransportOptions()).toMatchObject({
      host: 'smtp587.example.test', port: 587, secure: false, requireTLS: true,
      auth: { user: VALID.SYSTEM_MAIL_USER, pass: PASSWORD },
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    })
    expect(lastTransportOptions().ignoreTLS).toBeUndefined()
  })

  it('port 465 uses implicit TLS, with verified certificates and TLS 1.2+', async () => {
    configure({ SYSTEM_MAIL_HOST: 'smtp465.example.test', SYSTEM_MAIL_PORT: '465' })
    expect(await sendEmail('person@example.test', 'Subject', 'Body')).toEqual({ sent: true })
    expect(lastTransportOptions()).toMatchObject({ port: 465, secure: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
  })
})

describe('sending', () => {
  it('sends the exact recipient, subject and text as a plain-text message from the configured sender', async () => {
    configure()
    expect(await sendEmail('person@example.test', 'Your staff account invitation', 'Line one\nLine two')).toEqual({ sent: true })
    expect(mail.sendMail).toHaveBeenCalledExactlyOnceWith({ from: VALID.SYSTEM_MAIL_FROM_EMAIL, to: 'person@example.test', subject: 'Your staff account invitation', text: 'Line one\nLine two' })
  })

  it.each([
    ['a line break', 'person@example.test\r\nBcc: other@example.test'],
    ['two recipients (comma)', 'a@example.test,b@example.test'],
    ['two recipients (comma inside the local part)', 'a,b@example.test'],
    ['two recipients (semicolon)', 'a@example.test;b@example.test'],
    ['a display name', 'Person <person@example.test>'],
    ['no domain', 'person@'],
    ['empty', ''],
  ])('refuses a recipient with %s and contacts no server', async (_label, to) => {
    configure()
    expect(await sendEmail(to, 'Subject', 'Body')).toEqual({ sent: false, error: 'The email recipient or subject is not valid.' })
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it.each([
    ['a line feed', 'Subject\nBcc: other@example.test'],
    ['a carriage return', 'Subject\rBcc: other@example.test'],
    ['empty', ''],
  ])('refuses a subject with %s and contacts no server', async (_label, subject) => {
    configure()
    expect(await sendEmail('person@example.test', subject, 'Body')).toEqual({ sent: false, error: 'The email recipient or subject is not valid.' })
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it('NOTIFICATIONS_MODE does not change system email (existing behaviour, reported separately as finding E-1)', async () => {
    configure()
    vi.stubEnv('NOTIFICATIONS_MODE', 'test')
    vi.stubEnv('NOTIFICATIONS_TEST_RECIPIENTS', '')
    expect(await sendEmail('person@example.test', 'Subject', 'Body')).toEqual({ sent: true })
    expect(mail.sendMail).toHaveBeenCalledOnce()
  })
})

describe('errors never expose secrets', () => {
  const LINK = 'https://erp.example.test/reset-password/fictional-one-time-token'

  it.each([
    ['an SMTP status', Object.assign(new Error(`535 rejected ${PASSWORD} ${LINK}`), { responseCode: 535 }), 'Email provider returned 535'],
    ['a network failure', Object.assign(new Error(`connect failed smtps://user:${PASSWORD}@smtp.example.test ${LINK}`), { code: 'ECONNECTION' }), 'Email provider could not be reached.'],
    ['a non-numeric status', Object.assign(new Error(PASSWORD), { responseCode: PASSWORD }), 'Email provider could not be reached.'],
  ])('%s becomes a fixed message; nothing is logged', async (_label, failure, expected) => {
    configure()
    const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    mail.sendMail.mockRejectedValueOnce(failure)
    const result = await sendEmail('person@example.test', 'Subject', `Open ${LINK}`)
    expect(result).toEqual({ sent: false, error: expected })
    expect(JSON.stringify(result)).not.toContain(PASSWORD)
    expect(JSON.stringify(result)).not.toContain('one-time-token')
    for (const spy of logged) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore() }
  })
})

describe('per-company student and parent email stays separate', () => {
  it('system settings do not configure it, and it keeps its own SMTP URL and sender', async () => {
    configure()
    expect(channelConfigured('email', 'EDX')).toBe(false)
    expect(await sendBrandEmail('EDX', 'student@example.test', 'Subject', 'Body')).toMatchObject({ ok: false, notConfigured: true })
    expect(mail.createTransport).not.toHaveBeenCalled()

    const url = 'smtps://brand:fictional@smtp-brand.example.test:465'
    vi.stubEnv('EMAIL_SMTP_URL_EDX', url)
    vi.stubEnv('EMAIL_FROM_EDX', 'Dr.Expert Edulinks <updates@example.test>')
    expect(await sendBrandEmail('EDX', 'student@example.test', 'Subject', 'Body')).toMatchObject({ ok: true, provider: 'smtp' })
    expect(mail.createTransport).toHaveBeenCalledExactlyOnceWith(url)
    expect(mail.sendMail).toHaveBeenCalledExactlyOnceWith({ from: 'Dr.Expert Edulinks <updates@example.test>', to: 'student@example.test', subject: 'Subject', text: 'Body' })
  })

  it('system email is not configured by per-company settings alone', () => {
    vi.stubEnv('EMAIL_SMTP_URL_EDX', 'smtps://brand:fictional@smtp-brand.example.test:465')
    vi.stubEnv('EMAIL_FROM_EDX', 'updates@example.test')
    vi.stubEnv('EMAIL_FROM', 'fallback@example.test')
    expect(emailConfigured()).toBe(false)
  })
})
