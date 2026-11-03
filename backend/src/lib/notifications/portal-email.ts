import 'server-only'
import { decryptSecret } from '../auth/mfa'
import { anonymous } from '../db'
import { notificationsMode, testAllowed } from './dispatcher'
import { channelConfigured, sendEmail } from './providers'
import { messageVars, renderTemplate } from './render'

/**
 * Sender for the secure student-portal link queue (auth_private.portal_email_outbox; finding N-7).
 *
 * - Runs from the scheduled sender (/api/cron/notifications, every minute); after a link is issued or requested it is
 *   also started with after() for faster delivery. Delivery never depends on after() alone.
 * - Messages are claimed with SKIP LOCKED, so parallel senders never send the same message twice. Every claim re-checks
 *   that the link is still valid (unused, unexpired, account enabled); revoked or expired links are never sent.
 * - The link is stored encrypted and decrypted only here, in memory; the rendered email is never stored. The database
 *   wipes the link as soon as the email is sent, fails finally, is skipped, recorded in test mode, expires or is revoked.
 * - Test mode (NOTIFICATIONS_MODE=test) behaves like the notification outbox: only allow-listed recipients receive
 *   the email; for everyone else the message is recorded as "test" and the link wiped.
 * - The database functions refuse to run in a signed-in user's context; neither the application role nor any staff
 *   member can read the queue table.
 */
interface Claimed {
  id: string; kind: string; to_address: string; link_encrypted: string | null; attempts: number; org_code: string; company: string
  student_name: string; student_code: string; template_subject: string | null; template_body: string | null
}
type Result = 'sent' | 'retry' | 'failed' | 'skipped' | 'test'

export async function deliverPortalEmails(limit = 25) {
  const summary = { sent: 0, retry: 0, failed: 0, skipped: 0, test: 0 }
  const claimed = await anonymous((tx) => tx<Claimed[]>`select * from app.portal_email_claim(${limit})`)
  for (const m of claimed) {
    const finish = async (result: Result, error: string | null = null, provider: string | null = null, providerId: string | null = null) => {
      const [r] = await anonymous((tx) => tx<{ s: string | null }[]>`select app.portal_email_finish(${m.id}, ${result}, ${error}, ${provider}, ${providerId}) as s`)
      const s = r?.s
      if (s === 'queued') summary.retry++
      else if (s === 'sent' || s === 'failed' || s === 'skipped' || s === 'test') summary[s]++
    }
    let link: string
    try {
      if (!m.link_encrypted) throw new Error('missing')
      link = decryptSecret(m.link_encrypted)
    } catch {
      await finish('failed', 'The stored link could not be read.')
      continue
    }
    if (notificationsMode() === 'test' && !testAllowed('email', m.to_address)) { await finish('test', 'Test mode: not sent'); continue }
    if (!channelConfigured('email', m.org_code)) { await finish('skipped', 'email not configured'); continue }
    const vars = messageVars({ student_name: m.student_name, student_code: m.student_code, company: m.company }, { link })
    const subject = renderTemplate(m.template_subject, vars) || m.company
    const body = renderTemplate(m.template_body, vars)
    if (!body.includes(link)) { await finish('failed', 'The email template does not contain the {{link}} placeholder.'); continue }
    const r = await sendEmail(m.org_code, m.to_address, subject, body)
    if (r.ok) await finish('sent', null, r.provider, r.providerId)
    else await finish(r.transient ? 'retry' : 'failed', r.error, r.provider)
  }
  return summary
}
