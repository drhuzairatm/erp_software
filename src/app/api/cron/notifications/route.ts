import { NextResponse } from 'next/server'
import { processQueue } from '@/server/notifications/dispatcher'
import { emailSecurityAlerts } from '@/server/security/jobs'

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
  return NextResponse.json({ ...result, securityAlerts }, { headers: { 'Cache-Control': 'no-store' } })
}
