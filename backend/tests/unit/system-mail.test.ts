/**
 * System email over SMTP (backend/src/lib/email.ts). Nodemailer is fully mocked: nothing connects to a server and no
 * email is sent. All settings are fictional. Also checks that per-company student/parent SMTP stays separate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

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
const configure = (values: Partial<typeof VALID> = {}) => {
  vi.stubEnv('NOTIFICATIONS_MODE', 'live') // delivery tests; test-mode behaviour has its own section below
  for (const [k, v] of Object.entries({ ...VALID, ...values })) vi.stubEnv(k, v)
}
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

  it.each([
    ['an apostrophe', "o'brien@example.test"],
    ['an apostrophe and a plus', "mary.o'neil+staff@example.test"],
  ])('accepts a recipient with %s, the same addresses the staff forms accept', async (_label, to) => {
    configure()
    expect(z.email().safeParse(to).success).toBe(true)
    expect(await sendEmail(to, 'Subject', 'Body')).toEqual({ sent: true })
    expect(mail.sendMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to }))
  })

  it('a real Nodemailer message addresses an apostrophe recipient correctly (no server contacted)', async () => {
    const real = await vi.importActual<typeof import('nodemailer')>('nodemailer')
    const to = "o'brien@example.test"
    const info = await real.default.createTransport({ jsonTransport: true }).sendMail({ from: 'no-reply@example.test', to, subject: 'Subject', text: 'Body' })
    expect(info.envelope.to).toEqual([to])
  })

  it('still refuses an apostrophe in the domain', async () => {
    configure()
    expect(await sendEmail("person@exam'ple.test", 'Subject', 'Body')).toEqual({ sent: false, error: 'The email recipient or subject is not valid.' })
    expect(mail.sendMail).not.toHaveBeenCalled()
  })
})

describe('test mode cannot send real system email', () => {
  const RESEND = { RESEND_API_KEY: 're_fictional_key_value', EMAIL_FROM: 'no-reply@example.test' }
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { vi.unstubAllGlobals() })

  it.each([
    ['NOTIFICATIONS_MODE=test', 'test'],
    ['NOTIFICATIONS_MODE unset', undefined],
    ['an unrecognised mode', 'Live'],
  ])('%s: neither SMTP nor Resend is contacted', async (_label, mode) => {
    for (const provider of ['smtp', 'resend']) {
      vi.unstubAllEnvs()
      if (provider === 'smtp') configure()
      else for (const [k, v] of Object.entries(RESEND)) vi.stubEnv(k, v)
      vi.stubEnv('NOTIFICATIONS_MODE', mode)
      vi.stubEnv('NOTIFICATIONS_TEST_RECIPIENTS', '')
      expect(await sendEmail('person@example.test', 'Subject', 'Body')).toEqual({ sent: false, testMode: true, error: 'Test mode: not sent' })
    }
    expect(mail.sendMail).not.toHaveBeenCalled()
    expect(mail.createTransport).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('only an allow-listed test recipient receives it, as in the other queues', async () => {
    configure()
    vi.stubEnv('NOTIFICATIONS_MODE', 'test')
    vi.stubEnv('NOTIFICATIONS_TEST_RECIPIENTS', 'Tester@example.test')
    expect(await sendEmail('tester@example.test', 'Subject', 'Body')).toEqual({ sent: true })
    expect(await sendEmail('person@example.test', 'Subject', 'Body')).toMatchObject({ sent: false, testMode: true })
    expect(mail.sendMail).toHaveBeenCalledOnce()
  })
})

describe('Resend (the configured provider where no SMTP settings are set)', () => {
  const KEY = 're_fictional_key_value'
  const LINK = 'https://erp.example.test/reset-password/fictional-one-time-token'
  const fetchMock = vi.fn()
  const resend = (from = 'no-reply@example.test') => {
    vi.stubEnv('NOTIFICATIONS_MODE', 'live')
    vi.stubEnv('RESEND_API_KEY', KEY)
    vi.stubEnv('EMAIL_FROM', from)
  }
  beforeEach(() => { fetchMock.mockReset().mockResolvedValue(new Response('{"id":"fictional"}', { status: 200 })); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends through the Resend API with the configured key and sender', async () => {
    resend()
    expect(emailConfigured()).toBe(true)
    expect(await sendEmail("o'brien@example.test", 'Subject', 'Body')).toEqual({ sent: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(init.body)).toEqual({ from: 'no-reply@example.test', to: ["o'brien@example.test"], subject: 'Subject', text: 'Body' })
    expect(mail.createTransport).not.toHaveBeenCalled()
  })

  it('accepts the sender in display-name form', async () => {
    resend('Dr.Expert Edulinks <no-reply@example.test>')
    expect(await sendEmail('person@example.test', 'Subject', 'Body')).toEqual({ sent: true })
  })

  it.each([
    ['no key', { RESEND_API_KEY: '' }],
    ['no sender', { EMAIL_FROM: '' }],
    ['a sender that is not an address', { EMAIL_FROM: 'nobody' }],
    ['a sender with a line break', { EMAIL_FROM: 'a@example.test\r\nBcc: b@example.test' }],
    ['a key with a line break', { RESEND_API_KEY: 'key\r\nX-Other: 1' }],
  ])('%s: not configured and nothing is sent', async (_label, values) => {
    resend()
    for (const [k, v] of Object.entries(values)) vi.stubEnv(k, v)
    expect(emailConfigured()).toBe(false)
    expect(await sendEmail('person@example.test', 'Subject', 'Body')).toEqual({ sent: false, error: 'Email delivery is not configured.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('SMTP is used when its settings are complete, and Resend is not called', async () => {
    resend()
    configure()
    expect(await sendEmail('person@example.test', 'Subject', 'Body')).toEqual({ sent: true })
    expect(mail.sendMail).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refused recipients and subjects never reach Resend', async () => {
    resend()
    expect(await sendEmail('a@example.test,b@example.test', 'Subject', 'Body')).toMatchObject({ sent: false })
    expect(await sendEmail('person@example.test', 'Subject\nBcc: b@example.test', 'Body')).toMatchObject({ sent: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('errors keep only the status, and a network failure exposes nothing', async () => {
    resend()
    fetchMock.mockResolvedValueOnce(new Response(`rejected ${KEY} ${LINK}`, { status: 422 }))
    expect(await sendEmail('person@example.test', 'Subject', `Open ${LINK}`)).toEqual({ sent: false, error: 'Email provider returned 422' })
    fetchMock.mockRejectedValueOnce(new Error(`failed ${KEY} ${LINK}`))
    expect(await sendEmail('person@example.test', 'Subject', `Open ${LINK}`)).toEqual({ sent: false, error: 'Email provider could not be reached.' })
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
