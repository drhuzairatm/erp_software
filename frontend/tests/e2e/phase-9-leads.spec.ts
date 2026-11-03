import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('a friend uses a referral link; the lead reaches the right company; staff follow up and register the student', async ({ page }) => {
  // a referral code for a fictional demo student (created the first time the student opens the portal)
  const [s] = await admin`select id from students where is_demo and status = 'active' and originating_org_id = (select id from organizations where code = 'EDX') order by created_at limit 1`
  await admin`insert into referral_codes (student_id, code) values (${s.id}, ${'E2E' + Date.now().toString(36).toUpperCase().replace(/[01IO]/g, 'Z').slice(-7)}) on conflict (student_id) do nothing`
  const [{ code }] = await admin`select code from referral_codes where student_id = ${s.id}`
  const n = Date.now().toString().slice(-6)

  await page.goto(`/refer/${code}`)
  await expect(page.getByRole('heading', { name: /thinks you might be interested/ })).toBeVisible()
  await page.getByLabel('Your name *').fill(`Referral Friend ${n}`)
  await page.getByLabel('Mobile number').fill(`98${n}${n.slice(0, 2)}`)
  await page.getByLabel('Course / programme *').selectOption({ label: 'MBBS' })
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Send my details' }).click()
  await expect(page.getByText('Thank you! Our team will contact you soon.')).toBeVisible()

  await login(page, 'edx.manager@demo.test')
  await page.goto('/leads?view=referrals')
  await page.getByRole('link', { name: `Referral Friend ${n}` }).click()
  await expect(page.getByText(/Dr\.Expert Edulinks · Referral/)).toBeVisible()
  await page.getByLabel('Status').selectOption({ label: 'Interested' })
  await page.getByLabel('What happened?').fill('Spoke to the friend; interested in MBBS')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Spoke to the friend; interested in MBBS')).toBeVisible()
  await page.getByRole('button', { name: 'Register as student' }).click()
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/)
})
