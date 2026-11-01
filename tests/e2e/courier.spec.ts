import { expect, test } from '@playwright/test'
import { adminDb, login, securityClearAsMd } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('scan → approval → courier: address released only after approval; student submits tracking; staff receive and reconcile', async ({ page }) => {
  // a fictional demo student with an email and an approved scan that has no open courier instructions
  const [s] = await admin`
    select s.id, s.email, d.id as doc_id, t.name as doc_name from students s
      join student_documents d on d.student_id = s.id and d.status = 'approved'
      join document_types t on t.id = d.document_type_id
     where s.is_demo and s.status = 'active' and s.email is not null and s.originating_org_id = (select id from organizations where code = 'EDX')
       and not exists (select 1 from original_shipment_items i join original_shipments sh on sh.id = i.shipment_id where sh.student_id = s.id and sh.status not in ('completed', 'cancelled'))
     order by s.created_at desc limit 1`
  test.skip(!s, 'no demo student with an approved scan left (dev database is not reset)')
  const [addr] = await admin`select 1 from courier_addresses where is_active and org_id = (select id from organizations where code = 'EDX')`
  test.skip(!addr, 'no delivery address configured (run npm run demo:courier)')
  await securityClearAsMd(admin, s.doc_id) // courier release needs a clean scan or manual clearance

  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await page.goto(`/students/${s.id}?tab=documents`)
  const panel = page.locator('section', { has: page.getByRole('heading', { name: /Originals by courier/ }) })
  await panel.getByLabel('Delivery address *').selectOption({ index: 1 })
  await panel.locator('label', { hasText: s.doc_name }).first().getByRole('checkbox').check()
  await panel.getByRole('button', { name: 'Issue courier instructions' }).click()
  await expect(page.getByText(/Courier instructions issued/).first()).toBeVisible()

  // the student sees the address and submits the courier details
  await admin`update auth_private.portal_challenges set created_at = created_at - interval '2 hours' where created_at > now() - interval '1 hour'`
  const student = await page.context().browser()!.newPage({ viewport: { width: 390, height: 844 } })
  await student.goto('/portal')
  await student.getByLabel('Email or mobile number you registered with').fill(s.email)
  await student.getByRole('button', { name: 'Send me a code' }).click()
  await expect(student).toHaveURL(/\/portal\/verify\?c=/)
  const [m] = await admin`select params->>'code' as code from notification_messages where student_id = ${s.id} and event_key = 'portal_login_code' order by created_at desc limit 1`
  await student.getByLabel('6-digit code').fill(m.code)
  await student.getByRole('button', { name: 'Sign in' }).click()
  const courier = student.locator('section', { has: student.getByRole('heading', { name: 'Sending your original documents' }) })
  await expect(courier.locator('address').first()).toBeVisible()
  const card = courier.locator('div.card', { hasText: s.doc_name }).first()
  await card.getByLabel('Courier company *').fill('Fictional Express')
  await card.getByLabel('Tracking / consignment number *').fill(`FX${Date.now().toString().slice(-6)}`)
  await card.getByRole('button', { name: 'Send courier details' }).click()
  await expect(student.getByText('Thank you. Your courier details were sent to our team.')).toBeVisible()
  await student.close()

  // staff confirm receipt and reconcile against the approved scan
  await page.reload()
  const shipment = page.locator('section[aria-label="Courier shipment"]', { hasText: 'Fictional Express' }).first()
  await expect(shipment.getByText('Submitted by the student in the portal')).toBeVisible()
  await shipment.getByRole('button', { name: 'Confirm original received' }).click()
  await expect(page.getByText(/Receipt confirmed/)).toBeVisible()
  await shipment.getByLabel('Matches the approved scan').first().check()
  await shipment.getByRole('button', { name: 'Save reconciliation' }).click()
  await expect(shipment.getByText('Completed', { exact: true })).toBeVisible()
  await expect(shipment.getByText('Matches approved scan')).toBeVisible()
})
