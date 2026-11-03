import { assertNotificationConfig } from '@/lib/config/notifications-config'

/**
 * Runs once when a server instance starts, before it handles requests. A production server serves nothing (every request, /api/health included, gets HTTP 500) with an
 * unsafe notification configuration (finding N-8: NOTIFICATIONS_MODE must be exactly "live"; no local test mailbox).
 * Skipped while building, so `next build` does not need the runtime environment.
 */
export function register() {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  assertNotificationConfig()
}
