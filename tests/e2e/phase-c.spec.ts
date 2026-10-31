import { expect, test } from '@playwright/test'
import { placeholderPdf } from '../../scripts/lib/seed-demo'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('documentation staff review a PDF in the app; a manager approves', async ({ page }) => {
  // A student assigned to docs@, educated in India, with a Bonafide checklist item
  const [d] = await admin`
    select d.id as doc_id, d.student_id from student_documents d
      join document_types t on t.id = d.document_type_id and t.key = 'bonafide_certificate'
      join students s on s.id = d.student_id
      join countries c on c.id = s.previous_education_country_id and c.code = 'IN'
      join student_assignments a on a.student_id = s.id and a.is_active and a.assignment_type = 'documentation'
      join user_profiles u on u.id = a.user_id and u.email = 'docs@demo.test'
     where s.status = 'active' limit 1`
  const pdf = placeholderPdf('Bonafide e2e', ['This is to certify that the student is a bonafide student', 'and is eligible to pursue higher education in India and abroad.'])

  await login(page, 'docs@demo.test')
  await page.goto(`/students/${d.student_id}?tab=documents`)
  const item = page.locator('li', { hasText: 'Bonafide Certificate' }).first()
  await item.locator('input[type=file]').setInputFiles({ name: 'bonafide.pdf', mimeType: 'application/pdf', buffer: pdf })
  await item.getByRole('button', { name: 'Upload' }).click()
  await expect(item.getByText('Uploaded – pending review')).toBeVisible()
  await item.getByRole('link', { name: 'Open review' }).click()

  // The PDF renders in the app and the required wording is detected (hint only)
  await expect(page.getByText('Page', { exact: false }).first()).toBeVisible()
  await expect(page.locator('canvas.block')).toBeVisible()
  const phrase = page.locator('li', { hasText: 'eligible to pursue higher education in India and abroad' })
  await expect(phrase.getByText(/Found on page/)).toBeVisible({ timeout: 15000 })
  // Nothing is ticked automatically
  await expect(page.getByRole('button', { name: 'Mark verified' })).toBeDisabled()

  // Select text and comment on it
  await page.locator('.textLayer span', { hasText: 'eligible' }).first().dblclick()
  await page.getByLabel('Comment').last().fill('Wording confirmed against the approved text')
  await page.getByRole('button', { name: 'Add comment' }).click()
  await expect(page.getByText('Wording confirmed against the approved text')).toBeVisible()

  // Tick every mandatory check
  for (const text of ['eligible to pursue higher education in India and abroad', 'Signed by the head of the institution']) {
    const li = page.locator('section[aria-labelledby="checklist-h"] li', { hasText: text })
    await li.getByRole('button', { name: '✓ Present' }).click()
    await expect(li.getByText('Present', { exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Mark verified' }).click()
  await page.getByRole('button', { name: 'Submit for manager approval' }).click()
  await expect(page.getByText('Pending manager approval').first()).toBeVisible()
  const reviewUrl = page.url()

  // Manager approves
  await login(page, 'edx.manager@demo.test')
  await page.goto(reviewUrl)
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/Verified by Joseph Mathew/)).toBeVisible()
})

test('MD manages verification rules; the CEO cannot open files', async ({ page }) => {
  await login(page, 'md@demo.test')
  await page.getByRole('link', { name: 'Verification rules' }).click()
  await expect(page.getByText('[PLACEHOLDER] Bonafide certificate – educated in Qatar')).toBeVisible()

  await login(page, 'ceo@demo.test')
  const [f] = await admin`select id from document_files limit 1`
  expect((await page.request.get(`/api/files/${f.id}/content`)).status()).toBe(404)
  expect((await page.request.get(`/api/files/${f.id}`, { maxRedirects: 0 })).status()).toBe(404)
})
