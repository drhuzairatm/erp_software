import { NextResponse } from 'next/server'
import { anonymous } from '@/lib/db'
import { rescanPendingFiles } from '@/lib/security/jobs'

/**
 * Daily housekeeping (e.g. Vercel Cron 02:30 UTC). Requires "Authorization: Bearer <CRON_SECRET>".
 * - passport expiry monitoring: follow-up/escalation tasks (deduplicated)
 * - pending email verifications past their expiry become "expired"
 * - attendance: yesterday's missing check-outs go to review and the person is told (nobody is marked absent)
 * - employee reminders for tasks due soon or overdue (one per task and due date)
 * - reminders to finance staff for unpaid charges due soon or overdue (one per charge, person and due date)
 * - files stored while no virus scanner was available are scanned (when a scanner is configured)
 * - authentication housekeeping (trusted browsers, reset-request log, finished staff emails; never the audit log)
 * - finished portal link emails older than 90 days (secure queue; the links were already wiped)
 * - finished sign-in code / verification messages older than 90 days (secure queue; the secrets were already wiped)
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 32 || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 })
  }
  const [r] = await anonymous((tx) => tx<{ tasks: number; emails: number }[]>`select app.passport_monitor() as tasks, app.expire_email_verifications() as emails`)
  const scan = await rescanPendingFiles(100)
  const reminders = await anonymous((tx) => tx<{ r: { reminders: number } }[]>`select app.staff_notifications_daily() as r`).then(([x]) => x.r, () => ({ error: true }))
  const paymentReminders = await anonymous((tx) => tx<{ n: number }[]>`select app.payment_due_reminders() as n`).then(([x]) => x.n, () => null)
  const attendance = await anonymous((tx) => tx<{ r: { missingCheckouts: number } }[]>`select app.attendance_daily() as r`).then(([x]) => x.r, () => ({ error: true }))
  const meetings = await anonymous((tx) => tx<{ r: { minutesDue: number } }[]>`select app.meetings_daily() as r`).then(([x]) => x.r, () => ({ error: true }))
  // Does nothing for a company without an MD-approved policy with automatic removal turned on.
  const chatRetention = await anonymous((tx) => tx<{ n: number }[]>`select app.chatgov_retention_tick() as n`).then(([x]) => ({ changed: x.n }), () => ({ error: true }))
  // authentication working data: expired/revoked trusted browsers, old reset-request log and finished staff emails
  const [{ auth }] = await anonymous((tx) => tx<{ auth: Record<string, number> }[]>`select app.auth_housekeeping() as auth`)
  const [{ portal }] = await anonymous((tx) => tx<{ portal: number }[]>`select app.portal_email_housekeeping() as portal`)
  const [{ authq }] = await anonymous((tx) => tx<{ authq: number }[]>`select app.auth_message_housekeeping() as authq`)
  return NextResponse.json({ staffReminders: reminders, paymentReminders, attendance, meetings, chatRetention, passportTasksCreated: r.tasks, emailVerificationsExpired: r.emails, virusScan: scan, authHousekeeping: auth, portalLinkEmailsRemoved: portal, authMessagesRemoved: authq },
    { headers: { 'Cache-Control': 'no-store' } })
}
