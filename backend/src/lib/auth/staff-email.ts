import 'server-only'
import { anonymous } from '../db'
import { emailConfigured, sendEmail } from '../email'
import { decryptSecret } from './mfa'

/**
 * Sender for the dedicated, durable staff email queue (auth_private.staff_email_outbox; finding N-1).
 *
 * - Runs from the scheduled sender (/api/cron/notifications, every minute); after a request it is also started with
 *   after() for faster delivery. Delivery never depends on after() alone.
 * - Messages are claimed with SKIP LOCKED, so parallel senders never send the same message twice.
 * - The reset link is stored encrypted and is decrypted only here, in memory; the database wipes it as soon as the
 *   email is sent, finally fails, is skipped or expires.
 * - The database functions refuse to run in a signed-in user's context, and neither the application role nor any staff
 *   member can read the queue table.
 */
interface Claimed { id: string; to_address: string; full_name: string; kind: string; link_encrypted: string | null; attempts: number }
type Result = 'sent' | 'retry' | 'failed' | 'skipped'

export async function deliverStaffEmails(limit = 25) {
  const summary = { sent: 0, retry: 0, failed: 0, skipped: 0 }
  const claimed = await anonymous((tx) => tx<Claimed[]>`select * from app.staff_email_claim(${limit})`)
  for (const m of claimed) {
    const finish = async (result: Result, error: string | null = null) => {
      const [r] = await anonymous((tx) => tx<{ s: string | null }[]>`select app.staff_email_finish(${m.id}, ${result}, ${error}) as s`)
      const s = r?.s
      if (s === 'sent') summary.sent++
      else if (s === 'queued') summary.retry++
      else if (s === 'failed') summary.failed++
      else if (s === 'skipped') summary.skipped++
    }
    let link: string
    try {
      if (!m.link_encrypted) throw new Error('missing')
      link = decryptSecret(m.link_encrypted)
    } catch {
      await finish('failed', 'The stored link could not be read.')
      continue
    }
    if (!emailConfigured()) {
      await finish('skipped', 'Email delivery is not configured.')
      continue
    }
    const r = await sendEmail(m.to_address, 'Reset your password',
      `Hello ${m.full_name},\n\nUse this link within 1 hour to set a new password:\n${link}\n\nIf you did not ask for this, ignore this email.`)
    if (r.testMode) { await finish('skipped', r.error); continue } // never delivered in test mode: no retries, link wiped
    await finish(r.sent ? 'sent' : 'retry', r.sent ? null : (r.error ?? 'Email could not be sent.'))
  }
  return summary
}
