/**
 * N-8 (browser): a sign-in code goes only through the secure queue. The MD's Messages page shows a redacted status row
 * (no code, no rendered email, no Retry); the student still signs in with the code from the local test mailbox
 * (development only, NOTIFICATIONS_TEST_MAILBOX=1). Fictional demo student; the code is never printed.
 */
import { expect, test } from '@playwright/test'
import { adminDb, codeFrom, fromTestMailbox, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('MD sees only a redacted sign-in-code row; the student signs in with the code', async ({ page, browser }) => {
  await admin`update auth_private.portal_challenges set created_at = created_at - interval '2 hours' where created_at > now() - interval '1 hour'`
  const [s] = await admin`
    select s.id, s.email from students s
     where s.is_demo and s.status = 'active' and s.email is not null and s.originating_org_id = (select id from organizations where code = 'EDX')
     order by s.created_at limit 1`
  const student = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await student.goto('/portal')
  const since = Date.now()
  await student.getByLabel('Email or mobile number you registered with').fill(s.email)
  await student.getByRole('button', { name: 'Send me a code' }).click()
  await expect(student).toHaveURL(/\/portal\/verify\?c=/)
  const code = codeFrom(await fromTestMailbox(s.email, 'portal_login_code', since))

  // the database never holds the code in a staff-readable place
  const [leak] = await admin`select count(*)::int as n from notification_messages where student_id = ${s.id} and (params::text like ${'%' + code + '%'} or coalesce(subject, '') || coalesce(body, '') like ${'%' + code + '%'})`
  expect(leak.n).toBe(0)

  // MD: Messages → filter "sign-in code": a redacted row, status "Test – not sent", no code, no Retry
  await login(page, 'md@demo.test')
  await page.goto('/notifications?event=portal_login_code')
  const row = page.locator('tr', { hasText: s.email }).first()
  await expect(row).toBeVisible()
  await expect(row.getByText('Sign-in code – hidden for security')).toBeVisible()
  await expect(row.getByText('Test – not sent')).toBeVisible()
  await expect(row.getByRole('button', { name: /Retry/ })).toHaveCount(0)
  expect(await page.content()).not.toContain(code)
  // and on the student's own Messages tab
  await page.goto(`/students/${s.id}?tab=messages`)
  await expect(page.getByText('Sign-in code – hidden for security').first()).toBeVisible()
  expect(await page.content()).not.toContain(code)

  // the right student signs in with it
  await student.getByLabel('6-digit code').fill(code)
  await student.getByRole('button', { name: 'Sign in' }).click()
  await expect(student.getByRole('heading', { name: 'Application progress' })).toBeVisible()
  await student.close()
})
