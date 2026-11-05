import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'
import { notificationsMode, testAllowed } from './notifications/mode'

/**
 * Transactional system email (staff invitations, staff password resets, security alerts). Two providers:
 * - SMTP through Nodemailer, when all SYSTEM_MAIL_* settings are valid. Port 465 uses implicit TLS and port 587 requires STARTTLS.
 * - otherwise Resend over HTTP, when RESEND_API_KEY and EMAIL_FROM are valid.
 *
 * If neither is configured, nothing is sent and { sent: false } is returned, so callers keep their fallback
 * (for example the one-time link shown to the administrator). Callers must never claim delivery in that case.
 *
 * Test mode (NOTIFICATIONS_MODE not exactly "live"): only NOTIFICATIONS_TEST_RECIPIENTS receive system email. For anyone
 * else no provider is contacted and { sent: false, testMode: true } is returned. This is the single gate for both providers.
 *
 * Per-company student and parent email is separate: see notifications/providers.ts.
 * Never log or return the password, a message body (it may contain a one-time link) or a raw provider error.
 */
const CONNECTION_TIMEOUT_MS = 10_000
const GREETING_TIMEOUT_MS = 10_000
const SOCKET_TIMEOUT_MS = 20_000
const MAX_ADDRESS_LENGTH = 254
const MAX_SUBJECT_LENGTH = 998 // RFC 5322 line limit
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/
// exactly one bare address: no display name, list separators, double quotes or white space. An apostrophe is valid in
// the local part (o'brien@example.com), as the staff forms accept, but never in the domain.
const ADDRESS = /^[^\s@,;:<>()[\]"\\]+@[^\s@,;:<>()[\]"'\\]+\.[^\s@,;:<>()[\]"'\\]+$/
const DISPLAY_NAME_SENDER = /^[^<>]*<([^<>]+)>$/
const RESEND_URL = 'https://api.resend.com/emails'
const RESEND_TIMEOUT_MS = 10_000

interface SmtpConfig { host: string; port: 465 | 587; from: string; user: string; password: string }
interface ResendConfig { apiKey: string; from: string }
export type SendEmailResult = { sent: boolean; error?: string; testMode?: true }

function hasControlCharacter(value: string) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c < 32 || c === 127) return true
  }
  return false
}

function validAddress(value: string) {
  return value.length <= MAX_ADDRESS_LENGTH && !hasControlCharacter(value) && ADDRESS.test(value) && !value.includes('..')
}

function validSubject(value: string) {
  return value.length > 0 && value.length <= MAX_SUBJECT_LENGTH && !hasControlCharacter(value)
}

/** The complete, valid SMTP settings, or null when any is missing or invalid (values are never reported). */
function smtpConfig(): SmtpConfig | null {
  const host = process.env.SYSTEM_MAIL_HOST ?? ''
  const port = process.env.SYSTEM_MAIL_PORT
  const from = process.env.SYSTEM_MAIL_FROM_EMAIL ?? ''
  const user = process.env.SYSTEM_MAIL_USER ?? ''
  const password = process.env.SYSTEM_MAIL_PASSWORD ?? ''
  if (!HOST.test(host) || (port !== '465' && port !== '587') || !validAddress(from) || !user || hasControlCharacter(user) || !password) return null
  return { host, port: port === '465' ? 465 : 587, from, user, password }
}

/** The Resend settings, or null when either is missing or invalid (values are never reported). */
function resendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY ?? ''
  const from = process.env.EMAIL_FROM ?? ''
  const address = from.match(DISPLAY_NAME_SENDER)?.[1] ?? from
  if (!apiKey || hasControlCharacter(apiKey) || hasControlCharacter(from) || !validAddress(address)) return null
  return { apiKey, from }
}

let cached: { key: string; transport: Transporter } | null = null

function transportFor(c: SmtpConfig): Transporter {
  const key = JSON.stringify([c.host, c.port, c.user, c.password])
  if (cached?.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.port === 465, // implicit TLS
        requireTLS: c.port === 587, // STARTTLS is mandatory: never fall back to plain text
        auth: { user: c.user, pass: c.password },
        tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: GREETING_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    }
  }
  return cached.transport
}

export function emailConfigured() {
  return smtpConfig() !== null || resendConfig() !== null
}

async function sendThroughResend(config: ResendConfig, to: string, subject: string, text: string): Promise<SendEmailResult> {
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [to], subject, text }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    })
    // Only the status is kept: the response text may echo the request.
    return res.ok ? { sent: true } : { sent: false, error: `Email provider returned ${res.status}` }
  } catch {
    return { sent: false, error: 'Email provider could not be reached.' }
  }
}

export async function sendEmail(to: string, subject: string, text: string): Promise<SendEmailResult> {
  const config = smtpConfig()
  const resend = config ? null : resendConfig()
  if (!config && !resend) return { sent: false, error: 'Email delivery is not configured.' }
  if (!validAddress(to) || !validSubject(subject)) return { sent: false, error: 'The email recipient or subject is not valid.' }
  if (notificationsMode() === 'test' && !testAllowed('email', to)) return { sent: false, testMode: true, error: 'Test mode: not sent' }
  if (!config) return sendThroughResend(resend!, to, subject, text)
  try {
    await transportFor(config).sendMail({ from: config.from, to, subject, text })
    return { sent: true }
  } catch (e) {
    // Only the numeric SMTP status is kept: provider error text may echo credentials or the message.
    const status = (e as { responseCode?: unknown }).responseCode
    return { sent: false, error: typeof status === 'number' ? `Email provider returned ${status}` : 'Email provider could not be reached.' }
  }
}

export function appUrl(path: string) {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  return base + path
}
