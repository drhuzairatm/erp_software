import 'server-only'
import { type AuthSecretKind, decryptAuthSecret } from '../auth/auth-message-crypto'
import { anonymous } from '../db'
import { notificationsMode, testAllowed } from './dispatcher'
import { type Channel, channelConfigured, sendEmail, sendWhatsApp } from './providers'
import { messageVars, renderTemplate, toInternationalDigits } from './render'
import { writeTestMailbox } from './test-mailbox'

/**
 * Sender for the secure authentication queue (auth_private.auth_message_outbox; finding N-8): portal sign-in codes
 * (email or WhatsApp) and email-verification links.
 *
 * - Runs from the scheduled sender (/api/cron/notifications, every minute) and right after a code or verification is
 *   requested (after()). Claimed with SKIP LOCKED: concurrent senders never send a message twice.
 * - The database re-checks every secret at claim time (expired, used, replaced or revoked → never sent, also not on retry).
 * - The secret is decrypted only here, in memory (authenticated decryption; anything malformed or tampered with fails),
 *   and the rendered message is never stored or logged. The database wipes the secret as soon as the message is sent,
 *   fails finally, is skipped, recorded in test mode, expires or is revoked.
 * - Provider errors are masked twice (here, then in the database) before storage: a provider may echo the request.
 * - Test mode: delivered only to NOTIFICATIONS_TEST_RECIPIENTS; otherwise recorded as "test" and wiped (in development
 *   with NOTIFICATIONS_TEST_MAILBOX=1 the rendered message goes to the local test mailbox, never to the database).
 */
interface Claimed {
  id: string; kind: AuthSecretKind; channel: Channel; to_address: string; secret_encrypted: string | null; attempts: number
  org_code: string; company: string; student_name: string; student_code: string
  template_subject: string | null; template_body: string | null; provider_template_name: string | null; provider_params: string[] | null
}
type Result = 'sent' | 'retry' | 'failed' | 'skipped' | 'test'

/** Never let a code, a link or a token reach storage through an error text. */
export function maskSecretText(text: string | null | undefined, secret?: string) {
  if (!text) return null
  let t = text
  if (secret) t = t.split(secret).join('••••')
  return t.replace(/\d{4,}/g, '••••').replace(/token=[A-Za-z0-9_-]+/g, 'token=••••').slice(0, 300)
}

export async function deliverAuthMessages(limit = 25) {
  const summary = { sent: 0, retry: 0, failed: 0, skipped: 0, test: 0 }
  const claimed = await anonymous((tx) => tx<Claimed[]>`select * from app.auth_message_claim(${limit})`)
  for (const m of claimed) {
    let secret: string | undefined
    const finish = async (result: Result, error: string | null = null, provider: string | null = null, providerId: string | null = null) => {
      const [r] = await anonymous((tx) => tx<{ s: string | null }[]>`
        select app.auth_message_finish(${m.id}, ${result}, ${maskSecretText(error, secret)}, ${provider}, ${providerId}) as s`)
      const s = r?.s
      if (s === 'queued') summary.retry++
      else if (s === 'sent' || s === 'failed' || s === 'skipped' || s === 'test') summary[s]++
    }
    try {
      if (!m.secret_encrypted) throw new Error('missing')
      secret = decryptAuthSecret(m.kind, m.secret_encrypted)
    } catch {
      await finish('failed', 'The stored secret could not be read.')
      continue
    }
    const vars = messageVars({ student_name: m.student_name, student_code: m.student_code, company: m.company },
      m.kind === 'portal_login_code' ? { code: secret } : { link: secret })
    const subject = m.channel === 'email' ? renderTemplate(m.template_subject, vars) || m.company : null
    const body = renderTemplate(m.template_body, vars)
    if (notificationsMode() === 'test' && !testAllowed(m.channel, m.to_address)) {
      const boxed = writeTestMailbox({ kind: m.kind, channel: m.channel, to: m.to_address, subject, body })
      await finish('test', boxed ? 'Test mode: not sent (local test mailbox)' : 'Test mode: not sent')
      continue
    }
    if (!channelConfigured(m.channel, m.org_code)) {
      await finish('skipped', m.channel === 'email' ? 'email not configured' : 'whatsapp not configured')
      continue
    }
    if (m.channel === 'email' && !body.includes(secret)) { await finish('failed', 'The email template does not contain the secret placeholder.'); continue }
    const r = m.channel === 'email'
      ? await sendEmail(m.org_code, m.to_address, subject || m.company, body)
      : await sendWhatsApp(m.org_code, toInternationalDigits(m.to_address), m.student_name, m.provider_template_name, m.provider_params ?? [], vars)
    if (r.ok) await finish('sent', null, r.provider, r.providerId)
    else await finish(r.transient ? 'retry' : 'failed', r.error, r.provider)
  }
  return summary
}
