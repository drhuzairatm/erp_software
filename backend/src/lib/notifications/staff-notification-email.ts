import 'server-only'
import { anonymous } from '../db'
import { appUrl, emailConfigured, sendEmail } from '../email'

/**
 * Sends the email copy of employee notifications through the system email. The email holds only a generic line and a link that
 * needs sign-in, never personal data. sendEmail applies test mode. Raw provider errors are never stored or returned.
 */
export async function deliverStaffNotificationEmails(limit = 50) {
  if (!emailConfigured()) return { sent: 0, reason: 'email not configured' }
  const due = await anonymous((tx) => tx<{ id: string; to_email: string; title: string; href: string }[]>`
    select * from app.staff_notification_email_claim(${limit})`)
  let sent = 0, skipped = 0, retried = 0
  for (const m of due) {
    const r = await sendEmail(m.to_email, m.title,
      `${m.title}.\n\nView it in the staff portal (sign-in required): ${appUrl(m.href)}\n\nNo personal details are included in this email.`)
      .catch(() => ({ sent: false as const, testMode: undefined }))
    const outcome = r.sent ? 'sent' : r.testMode ? 'skipped' : 'retry'
    await anonymous((tx) => tx`select app.staff_notification_email_finish(${m.id}, ${outcome})`)
    if (outcome === 'sent') sent++
    else if (outcome === 'skipped') skipped++
    else retried++
  }
  return { sent, skipped, retried }
}
