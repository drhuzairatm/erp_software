/** A failure in one sender must not stop the others: the notification queue, alerts, staff, portal and sign-in email. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const senders = vi.hoisted(() => ({
  processQueue: vi.fn(), emailSecurityAlerts: vi.fn(), deliverStaffEmails: vi.fn(), deliverPortalEmails: vi.fn(), deliverAuthMessages: vi.fn(),
}))
vi.mock('@/lib/notifications/dispatcher', () => ({ processQueue: senders.processQueue }))
vi.mock('@/lib/security/jobs', () => ({ emailSecurityAlerts: senders.emailSecurityAlerts }))
vi.mock('@/lib/auth/staff-email', () => ({ deliverStaffEmails: senders.deliverStaffEmails }))
vi.mock('@/lib/notifications/portal-email', () => ({ deliverPortalEmails: senders.deliverPortalEmails }))
vi.mock('@/lib/notifications/auth-message', () => ({ deliverAuthMessages: senders.deliverAuthMessages }))
vi.mock('@/lib/notifications/staff-notification-email', () => ({ deliverStaffNotificationEmails: async () => ({ sent: 0 }) }))

import { GET } from '@/app/api/cron/notifications/route'

const SECRET = 'fictional-cron-secret-0123456789-abcdefghij'
const run = () => GET(new Request('http://localhost/api/cron/notifications', { headers: { authorization: `Bearer ${SECRET}` } }))

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRET)
  senders.processQueue.mockReset().mockResolvedValue({ processed: 1, sent: 1, test: 0, failed: 0, skipped: 0, retry: 0 })
  senders.emailSecurityAlerts.mockReset().mockResolvedValue({ emailed: 0 })
  senders.deliverStaffEmails.mockReset().mockResolvedValue({ sent: 0 })
  senders.deliverPortalEmails.mockReset().mockResolvedValue({ sent: 0 })
  senders.deliverAuthMessages.mockReset().mockResolvedValue({ sent: 0 })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('scheduled sender', () => {
  it('a failing notification queue does not stop the other senders, and the failure is reported without its text', async () => {
    senders.processQueue.mockRejectedValue(new Error('connection to private-host refused'))
    const res = await run()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ processed: 0, error: true })
    expect(JSON.stringify(body)).not.toContain('private-host')
    for (const s of [senders.emailSecurityAlerts, senders.deliverStaffEmails, senders.deliverPortalEmails, senders.deliverAuthMessages]) expect(s).toHaveBeenCalledOnce()
  })

  it('reports normal results unchanged', async () => {
    const body = await (await run()).json()
    expect(body).toMatchObject({ processed: 1, sent: 1 })
    expect(body.error).toBeUndefined()
  })
})
