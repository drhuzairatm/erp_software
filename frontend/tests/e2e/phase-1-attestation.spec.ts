import { expect, test } from '@playwright/test'
import type postgres from 'postgres'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

/** Runs real database workflow functions as a given (fictional) staff member – the same functions the app calls. */
async function asUser<T>(email: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return admin.begin(async (tx) => {
    const [u] = await tx`select id from user_profiles where email = ${email}`
    await tx`select set_config('app.user_id', ${u.id}, true)`
    return fn(tx)
  }) as Promise<T>
}

test('documentation staff start and complete an apostille route for an approved document', async ({ page }) => {
  // an approved, India-issued document of a Bulgaria student (assigned to docs@) with no attestation yet
  const ready = () => admin`
    select d.id, d.student_id from student_documents d join students s on s.id = d.student_id
      join countries dc on dc.id = s.destination_country_id and dc.code = 'BG'
      join countries ic on ic.id = d.issuing_country_id and ic.code = 'IN'
      join student_assignments a on a.student_id = s.id and a.is_active and a.assignment_type = 'documentation'
      join user_profiles u on u.id = a.user_id and u.email = 'docs@demo.test'
     where d.status = 'approved' and d.approved_file_id = d.current_file_id
       and not exists (select 1 from document_attestations x where x.student_document_id = d.id)
     limit 1`
  let [d] = await ready()
  if (!d) {
    // the demo data has been used up by earlier runs: prepare one through the real workflow (upload in the app,
    // then verification, submission, MANUAL security clearance by the MD and approval by the manager)
    // a fresh FICTIONAL Bulgaria student (India-educated, assigned to docs@) – same path as the attestation demo script
    const sid = await asUser('edx.counsellor@demo.test', async (tx) => {
      const [r] = await tx`insert into students (originating_org_id, full_name, phone, email, destination_country_id, course_id,
          previous_education_country_id, registration_date, is_demo, created_by)
        values ((select id from organizations where code = 'EDX'), ${'Attestation E2E Student (Demo)'}, ${'+91 90093 ' + String(Date.now()).slice(-5)},
                ${'attest.e2e.' + Date.now() + '@example.test'}, (select id from countries where code = 'BG'), (select id from courses where code = 'MBBS'),
                (select id from countries where code = 'IN'), current_date, true, app.current_user_id()) returning id`
      return r.id as string
    })
    await asUser('edx.manager@demo.test', (tx) => tx`insert into student_assignments (student_id, user_id, org_id, assignment_type, assigned_by)
      values (${sid}, (select id from user_profiles where email = 'docs@demo.test'), (select id from organizations where code = 'EDX'), 'documentation', app.current_user_id())`)
    const [c] = await admin`select d.id, d.student_id from student_documents d join document_types t on t.id = d.document_type_id
      where d.student_id = ${sid} and t.key = 'plus_two_certificate'`
    expect(c).toBeDefined()
    await login(page, 'docs@demo.test')
    await page.goto(`/students/${c.student_id}?tab=documents`)
    await page.locator(`#file-${c.id}`).setInputFiles({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% fictional e2e certificate\n%%EOF') })
    await page.locator('form', { has: page.locator(`#file-${c.id}`) }).getByRole('button', { name: 'Upload' }).click()
    await expect.poll(async () => (await admin`select current_file_id from student_documents where id = ${c.id}`)[0].current_file_id).not.toBeNull()
    await asUser('docs@demo.test', async (tx) => {
      for (const q of await tx`select requirement_id from app.unmet_requirements(${c.id})`) await tx`select app.record_verification(${c.id}, ${q.requirement_id}, 'present', null, null)`
      await tx`select app.document_action(${c.id}, 'verify', null)`
      await tx`select app.document_action(${c.id}, 'submit', null)`
    })
    await asUser('md@demo.test', (tx) => tx`select app.clear_file_manually((select current_file_id from student_documents where id = ${c.id}),
      'Fictional e2e certificate – manual clearance (no scanner in development)')`)
    await asUser('edx.manager@demo.test', async (tx) => {
      await tx`select app.document_action(${c.id}, 'approve', null)`
      await tx`update student_documents set issuing_country_id = (select id from countries where code = 'IN') where id = ${c.id}`
    })
    ;[d] = await ready()
  }
  expect(d).toBeDefined()
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
