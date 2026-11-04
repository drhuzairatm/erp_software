import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'

/**
 * Transactional system email (staff invitations, staff password resets, security alerts): SMTP through Nodemailer,
 * configured by the SYSTEM_MAIL_* environment variables. Port 465 uses implicit TLS and port 587 requires STARTTLS.
 *
 * If any setting is missing or invalid, nothing is sent and { sent: false } is returned, so callers keep their fallback
 * (for example the one-time link shown to the administrator). Callers must never claim delivery in that case.
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
// exactly one bare address: no display name, list separators, quotes or white space
const ADDRESS = /^[^\s@,;:<>()[\]"'\\]+@[^\s@,;:<>()[\]"'\\]+\.[^\s@,;:<>()[\]"'\\]+$/

interface SmtpConfig { host: string; port: 465 | 587; from: string; user: string; password: string }

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
  return smtpConfig() !== null
}

export async function sendEmail(to: string, subject: string, text: string): Promise<{ sent: boolean; error?: string }> {
  const config = smtpConfig()
  if (!config) return { sent: false, error: 'Email delivery is not configured.' }
  if (!validAddress(to) || !validSubject(subject)) return { sent: false, error: 'The email recipient or subject is not valid.' }
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
