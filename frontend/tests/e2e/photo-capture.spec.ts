import { expect, type Page, test } from '@playwright/test'
import sharp from 'sharp'
import { adminDb, login } from './helpers'

// Chrome's fake camera stands in for a real webcam; permission is granted automatically unless a test overrides getUserMedia.
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } })

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

/** Records every camera stream so the test can check that all tracks are stopped. */
async function trackStreams(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __streams: MediaStream[] }
    w.__streams = []
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await orig(c); w.__streams.push(s); return s }
  })
}
const allTracksStopped = (page: Page) => page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')))

test('laptop camera: staff photo – live preview, capture, retake, use, save; camera released; avatar updates', async ({ page }) => {
  await trackStreams(page)
  const [u] = await admin`select id from user_profiles where email = 'edx.counsellor@demo.test'`
  const [{ before }] = await admin`select count(*)::int as before from staff_photos where user_id = ${u.id}`
  await login(page, 'md@demo.test')
  await page.goto(`/admin/users/${u.id}`)
  await page.getByRole('button', { name: 'Take photo' }).click()
  const cam = page.getByRole('dialog', { name: 'Take a photo' })
  await expect(cam.getByLabel('Live camera preview')).toBeVisible()
  await expect(cam.getByRole('button', { name: 'Capture' })).toBeEnabled()
  // live preview is mirrored
  expect(await cam.getByLabel('Live camera preview').evaluate((v) => getComputedStyle(v).transform)).toContain('matrix(-1')
  await cam.getByRole('button', { name: 'Capture' }).click()
  await expect(cam.getByRole('img', { name: 'Captured photo' })).toBeVisible()
  expect(await allTracksStopped(page)).toBe(true) // light off while reviewing
  await cam.getByRole('button', { name: 'Retake' }).click()
  await expect(cam.getByRole('button', { name: 'Capture' })).toBeEnabled()
  await cam.getByRole('button', { name: 'Capture' }).click()
  await cam.getByRole('button', { name: 'Use photo' }).click()
  await expect(cam).toHaveCount(0)
  expect(await allTracksStopped(page)).toBe(true)
  await expect(page.getByLabel('Drag to reposition the photo')).toBeVisible() // crop step
  await page.getByRole('button', { name: /Save photo|Confirm and replace photo/ }).click()
  // saved to the right staff record; the profile shows the new version (cache-busted URL) immediately
  await expect.poll(async () => (await admin`select count(*)::int as n from staff_photos where user_id = ${u.id}`)[0].n).toBe(before + 1)
  const [{ v }] = await admin`select max(version) as v from staff_photos where user_id = ${u.id}`
  await expect(page.locator(`img[src*="/api/staff/${u.id}/photo?"][src$="v=${v}"]`).first()).toBeVisible()
  // the staff list shows the same avatar
  await page.goto('/admin/users')
  await expect(page.locator(`img[src*="/api/staff/${u.id}/photo?size=thumb&v=${v}"]`).first()).toBeVisible()
})

test('laptop camera: student photo from the profile; cancel releases the camera without saving', async ({ page }) => {
  await trackStreams(page)
  const [s] = await admin`select id from students where is_demo and status = 'active' and originating_org_id = (select id from organizations where code = 'EDX') order by created_at desc limit 1`
  const [{ before }] = await admin`select count(*)::int as before from student_photos where student_id = ${s.id}`
  await login(page, 'edx.manager@demo.test')
  await page.goto(`/students/${s.id}`)
  await page.getByRole('button', { name: /Upload photo|Replace photo/ }).click()
  const edit = page.getByRole('dialog', { name: /Upload photo|Replace photo/ })
  // cancel first: nothing saved, camera stopped
  await edit.getByRole('button', { name: 'Take photo' }).click()
  const cam = page.getByRole('dialog', { name: 'Take a photo' })
  await expect(cam.getByRole('button', { name: 'Capture' })).toBeEnabled()
  await cam.getByRole('button', { name: 'Cancel' }).click()
  await expect(cam).toHaveCount(0)
  expect(await allTracksStopped(page)).toBe(true)
  expect((await admin`select count(*)::int as n from student_photos where student_id = ${s.id}`)[0].n).toBe(before)
  // now capture and save
  await edit.getByRole('button', { name: 'Take photo' }).click()
  await expect(cam.getByRole('button', { name: 'Capture' })).toBeEnabled()
  await cam.getByRole('button', { name: 'Capture' }).click()
  await cam.getByRole('button', { name: 'Use photo' }).click()
  await edit.getByRole('button', { name: /Save photo|Confirm and replace/ }).click()
  await expect.poll(async () => (await admin`select count(*)::int as n from student_photos where student_id = ${s.id}`)[0].n).toBe(before + 1)
  const [{ v }] = await admin`select max(version) as v from student_photos where student_id = ${s.id}`
  await expect(page.locator(`img[src*="/api/students/${s.id}/photo?"][src*="v=${v}"]`).first()).toBeVisible()
  // the student list shows the same, updated avatar
  await page.goto(`/students?q=${encodeURIComponent((await admin`select student_code from students where id = ${s.id}`)[0].student_code)}`)
  await expect(page.locator(`img[src*="/api/students/${s.id}/photo?size=thumb&v=${v}"]`).first()).toBeVisible()
  expect(await allTracksStopped(page)).toBe(true)
})

for (const [name, message] of [
  ['NotAllowedError', /Camera access is blocked.*System Settings > Privacy & Security > Camera/],
  ['NotFoundError', /No camera found\. You can upload a photograph from your gallery or files\./],
  ['NotReadableError', /currently being used by another application/],
] as const) {
  test(`camera error ${name} is explained; gallery still works`, async ({ page }) => {
    await page.addInitScript((n) => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('test', n)) }, name)
    await login(page, 'edx.manager@demo.test')
    await page.goto('/students/new')
    await page.getByRole('button', { name: 'Take photo' }).click()
    await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible()
    const png = await sharp({ create: { width: 500, height: 640, channels: 3, background: '#dde5ee' } }).png().toBuffer()
    await page.getByLabel('Choose a photo from the device').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: png })
    await expect(page.getByLabel('Drag to reposition the photo')).toBeVisible()
  })
}

test('insecure connection: clear message instead of a silent failure', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'isSecureContext', { get: () => false }) })
  await login(page, 'edx.manager@demo.test')
  await page.goto('/students/new')
  await page.getByRole('button', { name: 'Take photo' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Camera access requires a secure HTTPS connection.' })).toBeVisible()
})

test('gallery: JPG and PNG accepted, oversized photo compressed below 5 MB, non-image refused', async ({ page }) => {
  await login(page, 'edx.manager@demo.test')
  await page.goto('/students/new')
  const pick = (buffer: Buffer, name: string, mimeType: string) => page.getByLabel('Choose a photo from the device').setInputFiles({ name, mimeType, buffer })
  await pick(Buffer.from('%PDF-1.4 not a photo'), 'renamed.jpg', 'image/jpeg')
  await expect(page.getByRole('alert').filter({ hasText: 'Please choose a JPG or PNG photo.' })).toBeVisible()
  await pick(await sharp({ create: { width: 600, height: 800, channels: 3, background: '#e1e8f0' } }).jpeg().toBuffer(), 'a.jpg', 'image/jpeg')
  await expect(page.getByLabel('Drag to reposition the photo')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel / choose another' }).click()
  // ~8 MB noisy PNG (fictional) → compressed in the browser to a JPEG under 5 MB
  const noise = Buffer.alloc(2200 * 1300 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24
  const big = await sharp(noise, { raw: { width: 2200, height: 1300, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
  expect(big.length).toBeGreaterThan(5 * 1024 * 1024)
  await pick(big, 'big.png', 'image/png')
  await expect(page.getByLabel('Drag to reposition the photo')).toBeVisible()
  const size = await page.locator('input[type=file][name=photo]').evaluate((i) => (i as HTMLInputElement).files?.[0]?.size ?? 0)
  expect(size).toBeGreaterThan(0)
  expect(size).toBeLessThanOrEqual(5 * 1024 * 1024)
})

test('phone: Take photo opens the native camera (capture="user"); preview with Retake and Use photo; gallery has no capture', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, baseURL: 'http://localhost:3000' })
  const page = await ctx.newPage()
  await login(page, 'edx.manager@demo.test')
  await page.goto('/students/new')
  expect(await page.getByTestId('photo-camera-input').getAttribute('capture')).toBe('user')
  expect(await page.getByLabel('Choose a photo from the device').getAttribute('capture')).toBeNull()
  const jpg = await sharp({ create: { width: 720, height: 960, channels: 3, background: '#d9e2ec' } }).jpeg().toBuffer()
  let chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Take photo' }).click()
  await (await chooser).setFiles({ name: 'camera.jpg', mimeType: 'image/jpeg', buffer: jpg })
  await expect(page.getByRole('img', { name: 'Captured photo preview' })).toBeVisible()
  chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Retake' }).click()
  await (await chooser).setFiles({ name: 'camera2.jpg', mimeType: 'image/jpeg', buffer: jpg })
  await page.getByRole('button', { name: 'Use photo' }).click()
  await expect(page.getByLabel('Drag to reposition the photo')).toBeVisible()
  await ctx.close()
})

test('security headers allow the camera for the ERP only', async ({ request }) => {
  const r = await request.get('/login')
  expect(r.headers()['permissions-policy']).toContain('camera=(self)')
  expect(r.headers()['permissions-policy']).toContain('microphone=()')
})
