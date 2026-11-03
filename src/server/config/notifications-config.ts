/**
 * Notification configuration guard (finding N-8, owner decision 1 Nov 2026).
 *
 * NOTIFICATIONS_MODE values (exact, case-sensitive):
 *   live  → messages are delivered to students / parents (consent rules apply).
 *   test  → nothing is delivered except to addresses on NOTIFICATIONS_TEST_RECIPIENTS; other messages are recorded as
 *           "Test – not sent". Sign-in codes and verification links are wiped, never stored.
 *   anything else, or unset → treated as test by the sender (unchanged behaviour), BUT:
 *
 * Production (NODE_ENV=production, APP_ENV unset or "production") MUST set exactly NOTIFICATIONS_MODE=live; otherwise the
 * server serves nothing: every request gets HTTP 500 (src/instrumentation.ts). Staging (NODE_ENV=production with APP_ENV=staging) may use test or
 * live. Development and automated tests may use test mode. The local test mailbox (NOTIFICATIONS_TEST_MAILBOX=1) is
 * refused in every NODE_ENV=production environment, staging included.
 */
type Env = Record<string, string | undefined>

export interface NotificationConfigStatus {
  environment: 'production' | 'staging' | 'development'
  mode: 'live' | 'test'
  explicit: boolean
  testMailbox: boolean
  errors: string[]
  warnings: string[]
}

export function notificationConfigStatus(env: Env = process.env): NotificationConfigStatus {
  const errors: string[] = []
  const warnings: string[] = []
  const raw = env.NOTIFICATIONS_MODE
  const explicit = raw === 'live' || raw === 'test'
  const mode = raw === 'live' ? 'live' : 'test'
  let environment: NotificationConfigStatus['environment'] = 'development'
  if (env.NODE_ENV === 'production') {
    if (env.APP_ENV === 'staging') environment = 'staging'
    else if (env.APP_ENV === undefined || env.APP_ENV === '' || env.APP_ENV === 'production') environment = 'production'
    else { environment = 'production'; errors.push(`APP_ENV must be "production" or "staging" (or unset) in a production build; got "${env.APP_ENV}".`) }
  }
  const testMailbox = env.NOTIFICATIONS_TEST_MAILBOX !== undefined && env.NOTIFICATIONS_TEST_MAILBOX !== ''
  if (environment === 'production' && raw !== 'live') {
    errors.push(raw === undefined || raw === ''
      ? 'NOTIFICATIONS_MODE is not set. Production must set NOTIFICATIONS_MODE=live explicitly.'
      : `NOTIFICATIONS_MODE="${raw}" is not allowed in production. Production must set NOTIFICATIONS_MODE=live exactly.`)
  }
  if (environment === 'staging' && !explicit) errors.push('Staging must set NOTIFICATIONS_MODE to exactly "test" or "live".')
  if (environment !== 'development' && testMailbox) errors.push('NOTIFICATIONS_TEST_MAILBOX must not be set in a production build (development and tests only).')
  if (environment === 'development') {
    if (raw === undefined || raw === '') warnings.push('NOTIFICATIONS_MODE is not set: test mode (nothing is sent except to test recipients).')
    else if (!explicit) warnings.push(`NOTIFICATIONS_MODE="${raw}" is not a valid value: treated as test mode.`)
    if (env.NOTIFICATIONS_TEST_MAILBOX === '1') warnings.push('The local test mailbox is on (development only): sign-in codes and verification links go to .data/test-mailbox/.')
  }
  return { environment, mode, explicit, testMailbox: environment === 'development' && env.NOTIFICATIONS_TEST_MAILBOX === '1', errors, warnings }
}

/** Throws (refusing to start) when the configuration is not allowed. */
export function assertNotificationConfig(env: Env = process.env) {
  const s = notificationConfigStatus(env)
  if (s.errors.length) throw new Error(`Refusing to start: ${s.errors.join(' ')} See docs/DEPLOYMENT.md (notifications).`)
  return s
}
