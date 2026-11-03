import { NextResponse } from 'next/server'
import { deliverStaffEmails } from '@/lib/auth/staff-email'
import { processQueue } from '@/lib/notifications/dispatcher'
import { deliverAuthMessages } from '@/lib/notifications/auth-message'
import { deliverPortalEmails } from '@/lib/notifications/portal-email'
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
  const result = await processQueue(100)
  const securityAlerts = await emailSecurityAlerts().catch(() => ({ emailed: 0, reason: 'error' }))
  // staff password-reset emails (dedicated encrypted queue, finding N-1)
  const staffEmails = await deliverStaffEmails(50).catch(() => ({ error: true }))
  // student-portal set-up / reset link emails (dedicated encrypted queue, finding N-7)
  const portalLinkEmails = await deliverPortalEmails(50).catch(() => ({ error: true }))
  // portal sign-in codes and email-verification links (dedicated encrypted queue, finding N-8)
  const authMessages = await deliverAuthMessages(50).catch(() => ({ error: true }))
  return NextResponse.json({ ...result, securityAlerts, staffEmails, portalLinkEmails, authMessages }, { headers: { 'Cache-Control': 'no-store' } })
}
