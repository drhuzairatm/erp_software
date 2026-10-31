import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('documentation staff start and complete an apostille route for an approved document', async ({ page }) => {
  // an approved, India-issued document of a Bulgaria student (assigned to docs@) with no attestation yet
  const [d] = await admin`
    select d.id, d.student_id from student_documents d join students s on s.id = d.student_id
      join countries dc on dc.id = s.destination_country_id and dc.code = 'BG'
      join countries ic on ic.id = d.issuing_country_id and ic.code = 'IN'
      join student_assignments a on a.student_id = s.id and a.is_active and a.assignment_type = 'documentation'
      join user_profiles u on u.id = a.user_id and u.email = 'docs@demo.test'
     where d.status = 'approved' and d.approved_file_id = d.current_file_id
       and not exists (select 1 from document_attestations x where x.student_document_id = d.id)
     limit 1`
  test.skip(!d, 'no ready document in the demo data (run npm run demo:attestation)')
  await login(page, 'docs@demo.test')
  await page.goto(`/students/${d.student_id}/documents/${d.id}`)
  await expect(page.getByText('Ready for attestation')).toBeVisible()
  await page.getByText('[TO CONFIRM] Bulgaria – India-issued documents – Apostille').click()
  await page.getByRole('button', { name: 'Start attestation' }).click()
  await expect(page.getByText(/Processing · 0\/1/)).toBeVisible()
  // reference is required for this stage
  await page.getByRole('button', { name: 'Mark completed' }).click()
  await expect(page.getByText('A reference number is required for this stage.')).toBeVisible()
  await page.getByLabel('Reference / tracking no. *').fill('APOSTILLE-E2E-1')
  await page.getByRole('button', { name: 'Mark completed' }).click()
  await expect(page.locator('main').getByText('Completed', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Ref APOSTILLE-E2E-1')).toBeVisible()
  await page.goto(`/students/${d.student_id}?tab=documents`)
  await expect(page.getByText('Attested').first()).toBeVisible()
})

test('MD sees routes and authorities; report lists attestations in progress', async ({ page }) => {
  await login(page, 'md@demo.test')
  await page.getByRole('link', { name: 'Attestation routes' }).click()
  await expect(page.getByText('[TO CONFIRM] Bulgaria – UAE-issued documents – Legalisation')).toBeVisible()
  await expect(page.getByText('Embassy of Bulgaria in the UAE')).toBeVisible()
  await page.goto('/reports/attestation')
  await expect(page.getByRole('heading', { name: 'Attestation progress' })).toBeVisible()
  await expect(page.locator('tbody tr').first()).toBeVisible()
})
