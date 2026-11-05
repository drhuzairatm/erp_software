import { NextResponse } from 'next/server'
import { anonymous } from '@/lib/db'
import { deliverStaffEmails } from '@/lib/auth/staff-email'
import { processQueue } from '@/lib/notifications/dispatcher'
import { deliverAuthMessages } from '@/lib/notifications/auth-message'
import { deliverPortalEmails } from '@/lib/notifications/portal-email'
import { deliverStaffNotificationEmails } from '@/lib/notifications/staff-notification-email'
import { emailSecurityAlerts } from '@/lib/security/jobs'

/**
 * Scheduled sender (e.g. Vercel Cron every minute). Requires
 * "Authorization: Bearer <CRON_SECRET>". Retries and anything not sent
 * immediately after a staff action are delivered here.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 32 || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 })
  }
  // a failure here must not stop the senders below; the reason is not returned (it may name internal hosts)
  const result = await processQueue(100).catch(() => ({ processed: 0, error: true }))
  const securityAlerts = await emailSecurityAlerts().catch(() => ({ emailed: 0, reason: 'error' }))
  // staff password-reset emails (dedicated encrypted queue, finding N-1)
  const staffEmails = await deliverStaffEmails(50).catch(() => ({ error: true }))
  // student-portal set-up / reset link emails (dedicated encrypted queue, finding N-7)
  const portalLinkEmails = await deliverPortalEmails(50).catch(() => ({ error: true }))
  // portal sign-in codes and email-verification links (dedicated encrypted queue, finding N-8)
  const authMessages = await deliverAuthMessages(50).catch(() => ({ error: true }))
  // email copies of employee notifications (generic text and a link only)
  const staffNotifications = await deliverStaffNotificationEmails(50).catch(() => ({ error: true }))
  // task reminders, recorded deadline breaches and escalations (internal notifications only)
  const taskReminders = await anonymous((tx) => tx<{ r: Record<string, number> }[]>`select app.task_reminders_tick() as r`).then(([x]) => x.r, () => ({ error: true }))
  return NextResponse.json({ ...result, taskReminders, securityAlerts, staffEmails, portalLinkEmails, authMessages, staffNotifications }, { headers: { 'Cache-Control': 'no-store' } })
}
