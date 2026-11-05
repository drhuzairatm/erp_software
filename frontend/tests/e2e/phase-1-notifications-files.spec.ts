import { expect, test } from '@playwright/test'
import { Evidence } from './evidence'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('assign a task: the bell tells the assignee, opening marks it read; a file can be attached and is closed to others', async ({ page, request }) => {
  const ev = new Evidence('2-4 notification read and unread, secure file upload and download, file access restriction', [/status of 404/]) // the refusals below are asserted to be 404
  ev.watch(page, 'Manager, counsellor and other company')
  const title = `E2E notify ${Date.now().toString().slice(-6)}`
  await login(page, 'edx.manager@demo.test')
  await page.goto('/tasks/new')
  await page.getByLabel('Company').last().selectOption({ label: 'Dr.Expert Edulinks' })
  await page.locator('#title').fill(title)
  const [counsellor] = await admin`select id from user_profiles where email = 'edx.counsellor@demo.test'`
  await page.locator('#assignedTo').selectOption(counsellor.id)
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}/)
  const taskUrl = new URL(page.url()).pathname

  // attach a file: disguised content is refused, a real PDF is listed as not virus-scanned
  await page.locator('#task-file').setInputFiles({ name: 'not-really.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ this is not a pdf') })
  await page.getByRole('button', { name: 'Upload' }).click()
  await expect(page.getByText('Only PDF, JPEG, PNG or WebP files are accepted.')).toBeVisible()
  await page.locator('#task-file').setInputFiles({ name: 'evidence.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${title}\n%%EOF`) })
  await page.getByRole('button', { name: 'Upload' }).click()
  const link = page.getByRole('link', { name: 'evidence.pdf' })
  await expect(link).toBeVisible()
  await expect(page.getByText('Not virus-scanned')).toBeVisible()
  const fileHref = (await link.getAttribute('href'))!
  const opened = await page.request.get(fileHref, { maxRedirects: 0 })
  expect(opened.status()).toBe(302)

  // the assignee sees it in the bell and on the page; opening goes to the task and clears it
  await login(page, 'edx.counsellor@demo.test')
  await page.getByLabel(/Notifications|Alerts/).first().click()
  await page.getByRole('link', { name: 'All my notifications' }).click()
  await expect(page).toHaveURL(/\/my-notifications/)
  // the file added to the task is a separate notification
  await expect(page.getByRole('button', { name: new RegExp(`A file was added to a task.*${title}`) })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`A task was assigned to you.*${title}`) }).click()
  await expect(page).toHaveURL(new RegExp(`${taskUrl}$`))
  await page.goto('/my-notifications?view=unread')
  await expect(page.getByRole('button', { name: new RegExp(`assigned to you.*${title}`) })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'evidence.pdf' })).toHaveCount(0) // only on the task page

  // someone in the other company gets a plain 404 for the task and the file, and sees no notification
  await login(page, 'grd.manager@demo.test')
  expect((await page.request.get(fileHref, { maxRedirects: 0 })).status()).toBe(404)
  expect((await page.goto(taskUrl))?.status()).toBe(404)
  await page.goto('/my-notifications')
  await expect(page.getByText(title)).toHaveCount(0)

  // signed out
  await page.context().clearCookies()
  expect((await request.get(fileHref, { maxRedirects: 0 })).status()).toBe(404)
  await ev.finish('Disguised file refused, PDF stored and served by signed link, bell and page showed the notifications, opening cleared unread, other company and signed-out requests got 404')
})
