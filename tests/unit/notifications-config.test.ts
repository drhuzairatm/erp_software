/** N-8: notification configuration guard (production must be explicitly live) and the local test mailbox switch. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { assertNotificationConfig, notificationConfigStatus } from '@/server/config/notifications-config'
import { testMailboxEnabled } from '@/server/notifications/test-mailbox'

const prod = (e: Record<string, string | undefined> = {}) => ({ NODE_ENV: 'production', ...e })

describe('production requires NOTIFICATIONS_MODE=live exactly', () => {
  it('missing, empty, test, invalid or differently-cased values refuse to start', () => {
    for (const mode of [undefined, '', 'test', 'LIVE', 'Live', ' live', 'live ', 'yes', '1']) {
      const s = notificationConfigStatus(prod({ NOTIFICATIONS_MODE: mode }))
      expect(s.environment, String(mode)).toBe('production')
      expect(s.errors.length, String(mode)).toBeGreaterThan(0)
      expect(() => assertNotificationConfig(prod({ NOTIFICATIONS_MODE: mode })), String(mode)).toThrow(/^Refusing to start/)
    }
    for (const appEnv of [undefined, '', 'production']) {
      expect(() => assertNotificationConfig(prod({ NOTIFICATIONS_MODE: 'live', APP_ENV: appEnv }))).not.toThrow()
    }
    expect(assertNotificationConfig(prod({ NOTIFICATIONS_MODE: 'live' }))).toMatchObject({ environment: 'production', mode: 'live', explicit: true, errors: [] })
  })

  it('an unknown APP_ENV is refused (cannot be used to dodge the rule); the test mailbox is refused in production', () => {
    expect(() => assertNotificationConfig(prod({ NOTIFICATIONS_MODE: 'test', APP_ENV: 'dev' }))).toThrow(/APP_ENV/)
    expect(() => assertNotificationConfig(prod({ NOTIFICATIONS_MODE: 'live', APP_ENV: 'Staging' }))).toThrow(/APP_ENV/)
    expect(() => assertNotificationConfig(prod({ NOTIFICATIONS_MODE: 'live', NOTIFICATIONS_TEST_MAILBOX: '1' }))).toThrow(/TEST_MAILBOX/)
    expect(() => assertNotificationConfig(prod({ NOTIFICATIONS_MODE: 'live', NOTIFICATIONS_TEST_MAILBOX: '0' }))).toThrow(/TEST_MAILBOX/)
  })
})

describe('staging and development', () => {
  it('staging may use test or live, set explicitly; never the mailbox', () => {
    const st = (m?: string, box?: string) => prod({ APP_ENV: 'staging', NOTIFICATIONS_MODE: m, NOTIFICATIONS_TEST_MAILBOX: box })
    expect(assertNotificationConfig(st('test'))).toMatchObject({ environment: 'staging', mode: 'test' })
    expect(assertNotificationConfig(st('live'))).toMatchObject({ environment: 'staging', mode: 'live' })
    expect(() => assertNotificationConfig(st())).toThrow()
    expect(() => assertNotificationConfig(st('TEST'))).toThrow()
    expect(() => assertNotificationConfig(st('test', '1'))).toThrow(/TEST_MAILBOX/)
  })

  it('development starts in any case; an unset or invalid mode is a warning and means test mode', () => {
    expect(notificationConfigStatus({ NODE_ENV: 'development' })).toMatchObject({ environment: 'development', mode: 'test', explicit: false, errors: [] })
    expect(notificationConfigStatus({ NODE_ENV: 'development' }).warnings[0]).toMatch(/not set/)
    expect(notificationConfigStatus({ NODE_ENV: 'development', NOTIFICATIONS_MODE: 'Live' })).toMatchObject({ mode: 'test', errors: [] })
    expect(notificationConfigStatus({ NODE_ENV: 'test', NOTIFICATIONS_MODE: 'test' })).toMatchObject({ environment: 'development', warnings: [] })
    expect(notificationConfigStatus({ NODE_ENV: 'development', NOTIFICATIONS_MODE: 'test', NOTIFICATIONS_TEST_MAILBOX: '1' })).toMatchObject({ testMailbox: true })
    expect(() => assertNotificationConfig({ NODE_ENV: 'development' })).not.toThrow()
  })
})

describe('local test mailbox switch', () => {
  it('on only outside production and only with exactly NOTIFICATIONS_TEST_MAILBOX=1', () => {
    expect(testMailboxEnabled({ NODE_ENV: 'development', NOTIFICATIONS_TEST_MAILBOX: '1' })).toBe(true)
    expect(testMailboxEnabled({ NODE_ENV: 'test', NOTIFICATIONS_TEST_MAILBOX: '1' })).toBe(true)
    expect(testMailboxEnabled({ NODE_ENV: 'development' })).toBe(false)
    for (const v of ['true', 'yes', '0', '', ' 1']) expect(testMailboxEnabled({ NODE_ENV: 'development', NOTIFICATIONS_TEST_MAILBOX: v }), v).toBe(false)
    expect(testMailboxEnabled({ NODE_ENV: 'production', NOTIFICATIONS_TEST_MAILBOX: '1' })).toBe(false)
  })
})
