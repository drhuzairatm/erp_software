import { NextResponse } from 'next/server'
import { anonymous } from '@/server/db'
import { rescanPendingFiles } from '@/server/security/jobs'

/**
 * Daily housekeeping (e.g. Vercel Cron 02:30 UTC). Requires "Authorization: Bearer <CRON_SECRET>".
 * - passport expiry monitoring: follow-up/escalation tasks (deduplicated)
 * - pending email verifications past their expiry become "expired"
 * - files stored while no virus scanner was available are scanned (when a scanner is configured)
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 32 || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 })
  }
  const [r] = await anonymous((tx) => tx<{ tasks: number; emails: number }[]>`select app.passport_monitor() as tasks, app.expire_email_verifications() as emails`)
  const scan = await rescanPendingFiles(100)
  return NextResponse.json({ passportTasksCreated: r.tasks, emailVerificationsExpired: r.emails, virusScan: scan }, { headers: { 'Cache-Control': 'no-store' } })
}
