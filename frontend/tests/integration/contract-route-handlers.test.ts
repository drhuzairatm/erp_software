/**
 * Stage 0 characterization tests (Express refactor): the CURRENT contract of the 14 route handlers, recorded before any
 * change. Each later stage must keep these exact statuses, bodies, redirects and headers (docs/API_CONTRACT_INVENTORY.md).
 *
 * Real route handlers, real services, real sessions (password sign-in of fictional demo accounts), throwaway test
 * database only. Only the request headers and the browser's cookie jar are simulated (next/headers).
 * Assertions describe what the code does today, not what it should do.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let currentHeaders = new Headers({ 'user-agent': 'vitest-contract' })
let jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  headers: async () => currentHeaders,
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (k: string) => jar.has(k),
    set: (k: string | { name: string; value: string }, v?: string) => { if (typeof k === 'string') jar.set(k, v!); else jar.set(k.name, k.value) },
    delete: (k: string | { name: string }) => { jar.delete(typeof k === 'string' ? k : k.name) },
  }),
}))

import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { GET as attestationFileRoute } from '@/app/api/attestation-files/[id]/route'
import { GET as cronDaily } from '@/app/api/cron/daily/route'
import { GET as cronNotifications } from '@/app/api/cron/notifications/route'
import { GET as fileContentRoute } from '@/app/api/files/[id]/content/route'
import { GET as fileRoute } from '@/app/api/files/[id]/route'
import { GET as healthRoute } from '@/app/api/health/route'
import { GET as reportRoute } from '@/app/api/reports/[key]/route'
import { GET as staffPhotoRoute } from '@/app/api/staff/[id]/photo/route'
import { GET as storageLocalRoute } from '@/app/api/storage/local/route'
import { GET as importTemplateRoute } from '@/app/api/students/import-template/route'
import { POST as mergeRoute } from '@/app/api/students/[id]/merge/route'
import { GET as photoDownloadRoute } from '@/app/api/students/[id]/photo/download/route'
import { GET as photoRoute } from '@/app/api/students/[id]/photo/route'
import { GET as portalFileRoute } from '@/app/portal/files/[id]/route'
import { login } from '@/lib/auth/session'
import { anonymous, db } from '@/lib/db'
import * as documents from '@/services/documents'
import { saveStudentPhoto } from '@/services/photos'
import { importTemplateCsv } from '@/services/student-import'
import * as students from '@/services/students'
import { adminSql, ctxFor, orgId } from '../../../backend/tests/support/helpers'
import { startApiProcess } from './support/api-process'

const UNKNOWN = '00000000-0000-4000-8000-000000000000'
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
/**
 * The browser request. Since Stage 2 it also carries the simulated jar's cookies as the Cookie header: route handlers
 * that proxy to the internal API forward that header (the others still read the simulated next/headers jar).
 */
const req = (url: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  if (cookie && !headers.has('cookie')) headers.set('cookie', cookie)
  return new Request(`http://localhost${url}`, { ...init, headers })
}
let EDX: string

/** Signs a fictional demo account in with the real password sign-in; the session cookie lands in the simulated jar. */
async function signIn(email: string) {
  jar = new Map()
  currentHeaders = new Headers({ 'user-agent': 'vitest-contract' })
  const r = await login(email, process.env.SEED_DEMO_PASSWORD!)
  expect(r, `sign-in ${email}`).toMatchObject({ ok: true, mfaPending: false, mustChangePassword: false })
}
const signOut = () => { jar = new Map() }

/** Headers that matter for the contract, as a plain object (absent = null). */
const H = (res: Response, names: string[]) => Object.fromEntries(names.map((n) => [n, res.headers.get(n)]))
const FILE_HEADERS = ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options', 'content-security-policy', 'referrer-policy', 'location']

/** A fictional student with one uploaded PDF, recorded as scanned clean (the trusted scanner path). */
async function uploadedDocument(content?: Uint8Array<ArrayBuffer>) {
  const mgr = await ctxFor('edx.manager@demo.test'); const docs = await ctxFor('docs@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Contract Student', phone: `+91 90061 ${rand()}` })
  if (!r.ok) throw new Error('student not created')
  await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
  const item = (await documents.getChecklist(mgr, r.id)).items.find((i) => i.type_key === 'plus_two_certificate')!
  // default: a minimal file that passes the upload checks but that pdf-lib cannot read (used for the 'damaged' merge contract)
  const bytes = content ?? new TextEncoder().encode(`%PDF-1.4\n% fictional contract ${rand()}\n%%EOF`)
  await documents.uploadDocument(docs, item.id, new File([bytes], 'scan.pdf', { type: 'application/pdf' }))
  const [f] = await adminSql()`select f.id, f.storage_key from student_documents d join document_files f on f.id = d.current_file_id where d.id = ${item.id}`
  await anonymous((tx) => tx`select app.record_file_scan(${f.storage_key}, 'clean', 'ClamAV', null)`)
  return { studentId: r.id, documentId: item.id, fileId: f.id as string, bytes }
}

// proxied routes (health since Stage 1; files and photos since Stage 2) reach the real Express API in a separate process
let api: Awaited<ReturnType<typeof startApiProcess>>
beforeAll(async () => { EDX = await orgId('EDX'); api = await startApiProcess() })
afterAll(async () => { await api.close(); await adminSql().end(); await db().end() })

describe('GET /api/health', () => {
  // since Stage 1 the route handler proxies to the Express API (started for this file in a separate process)
  it('200 {"status":"ok"} with no-store', async () => {
    const res = await healthRoute(req('/api/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(H(res, ['content-type', 'cache-control'])).toEqual({ 'content-type': 'application/json', 'cache-control': 'no-store' })
  })
})

describe('document files: /api/files/[id], /api/storage/local, /api/files/[id]/content', () => {
  let d: Awaited<ReturnType<typeof uploadedDocument>>
  beforeAll(async () => { d = await uploadedDocument() })

  it('signed out: 404 "Not found" without a cache header (both routes)', async () => {
    signOut()
    for (const route of [fileRoute, fileContentRoute]) {
      const res = await route(req(`/api/files/${d.fileId}`), params({ id: d.fileId }))
      expect(res.status).toBe(404)
      expect(await res.text()).toBe('Not found')
      expect(res.headers.get('cache-control')).toBeNull()
    }
  })

  it('signed in but not allowed (other company) or unknown id: 404 "Not found" with no-store', async () => {
    await signIn('grd.manager@demo.test')
    for (const id of [d.fileId, UNKNOWN]) {
      for (const route of [fileRoute, fileContentRoute]) {
        const res = await route(req(`/api/files/${id}`), params({ id }))
        expect(res.status).toBe(404)
        expect(await res.text()).toBe('Not found')
        expect(res.headers.get('cache-control')).toBe('no-store')
      }
    }
  })

  it('allowed: 302 to a signed local-storage link, no-store and no-referrer, empty body', async () => {
    await signIn('docs@demo.test')
    const res = await fileRoute(req(`/api/files/${d.fileId}`), params({ id: d.fileId }))
    expect(res.status).toBe(302)
    expect(await res.text()).toBe('')
    const location = res.headers.get('location')!
    const u = new URL(location, 'http://localhost')
    expect(u.pathname).toBe('/api/storage/local')
    expect([...u.searchParams.keys()].sort()).toEqual(['e', 'f', 'k', 's', 't'])
    expect(u.searchParams.get('t')).toBe('application/pdf')
    expect(H(res, ['cache-control', 'referrer-policy'])).toEqual({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })

    // the signed link serves the bytes without any session
    signOut()
    const file = await storageLocalRoute(req(`${u.pathname}${u.search}`))
    expect(file.status).toBe(200)
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(d.bytes)
    const name = u.searchParams.get('f')!.replace(/[^\w.\- ()]/g, '_')
    expect(H(file, FILE_HEADERS)).toEqual({
      'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'referrer-policy': 'no-referrer', location: null,
    })

    // a tampered signature or a type outside the allow-list: 403 "Link expired or invalid", no-store
    const bad = new URL(u); bad.searchParams.set('s', 'x'.repeat(64))
    const wrongType = new URL(u); wrongType.searchParams.set('t', 'text/html')
    for (const x of [bad, wrongType]) {
      const r = await storageLocalRoute(req(`${x.pathname}${x.search}`))
      expect(r.status).toBe(403)
      expect(await r.text()).toBe('Link expired or invalid')
      expect(r.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('allowed: the in-app viewer route returns the bytes inline with the sandbox policy', async () => {
    await signIn('docs@demo.test')
    const res = await fileContentRoute(req(`/api/files/${d.fileId}/content`), params({ id: d.fileId }))
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(d.bytes)
    expect(H(res, FILE_HEADERS)).toEqual({
      'content-type': 'application/pdf', 'content-disposition': 'inline', 'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': null, location: null,
    })
  })
})

describe('GET /api/attestation-files/[id]', () => {
  it('signed out: 404 without a cache header; unknown id: 404 no-store', async () => {
    signOut()
    let res = await attestationFileRoute(req(`/api/attestation-files/${UNKNOWN}`), params({ id: UNKNOWN }))
    expect([res.status, await res.text(), res.headers.get('cache-control')]).toEqual([404, 'Not found', null])
    await signIn('docs@demo.test')
    res = await attestationFileRoute(req(`/api/attestation-files/${UNKNOWN}`), params({ id: UNKNOWN }))
    expect([res.status, await res.text(), res.headers.get('cache-control')]).toEqual([404, 'Not found', 'no-store'])
  })
})

describe('student photo: /api/students/[id]/photo and /photo/download', () => {
  let studentId: string
  beforeAll(async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Contract Photo Student', phone: `+91 90062 ${rand()}` })
    if (!r.ok) throw new Error('student not created')
    studentId = r.id
    const jpeg = await sharp({ create: { width: 420, height: 540, channels: 3, background: { r: 120, g: 140, b: 160 } } }).jpeg().toBuffer()
    await saveStudentPhoto(mgr, studentId, new File([new Uint8Array(jpeg)], 'photo.jpg', { type: 'image/jpeg' }), null)
  })

  it('thumb and portrait: 200 image, private 5-minute cache, nosniff, default-src none', async () => {
    await signIn('edx.manager@demo.test')
    for (const size of [null, 'portrait']) {
      const res = await photoRoute(req(`/api/students/${studentId}/photo${size ? `?size=${size}` : ''}`), params({ id: studentId }))
      expect(res.status).toBe(200)
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
      expect(H(res, ['content-type', 'cache-control', 'x-content-type-options', 'content-security-policy'])).toEqual({
        'content-type': 'image/jpeg', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'",
      })
    }
  })

  it('download: 302 to a signed local-storage link, no-store and no-referrer', async () => {
    await signIn('edx.manager@demo.test')
    const res = await photoDownloadRoute(req(`/api/students/${studentId}/photo/download`), params({ id: studentId }))
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!, 'http://localhost').pathname).toBe('/api/storage/local')
    expect(H(res, ['cache-control', 'referrer-policy'])).toEqual({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
  })

  it('signed out: 404 without a cache header; other company: 404 no-store (both routes)', async () => {
    signOut()
    for (const route of [photoRoute, photoDownloadRoute]) {
      const res = await route(req(`/api/students/${studentId}/photo`), params({ id: studentId }))
      expect([res.status, await res.text(), res.headers.get('cache-control')]).toEqual([404, 'Not found', null])
    }
    await signIn('grd.manager@demo.test')
    for (const route of [photoRoute, photoDownloadRoute]) {
      const res = await route(req(`/api/students/${studentId}/photo`), params({ id: studentId }))
      expect([res.status, await res.text(), res.headers.get('cache-control')]).toEqual([404, 'Not found', 'no-store'])
    }
  })
})

describe('GET /api/staff/[id]/photo', () => {
  it('signed out: 404 without a cache header; no photo or unknown id: 404 no-store', async () => {
    signOut()
    const me = await ctxFor('edx.manager@demo.test')
    let res = await staffPhotoRoute(req(`/api/staff/${me.userId}/photo`), params({ id: me.userId }))
    expect([res.status, await res.text(), res.headers.get('cache-control')]).toEqual([404, 'Not found', null])
    await signIn('edx.manager@demo.test')
    res = await staffPhotoRoute(req(`/api/staff/${UNKNOWN}/photo`), params({ id: UNKNOWN }))
    expect([res.status, await res.text(), res.headers.get('cache-control')]).toEqual([404, 'Not found', 'no-store'])
  })
})

describe('GET /api/students/import-template', () => {
  it('signed out: 404; signed in: the CSV template as an attachment, no-store', async () => {
    signOut()
    let res = await importTemplateRoute(req('/api/students/import-template'))
    expect([res.status, await res.text()]).toEqual([404, 'Not found'])
    await signIn('edx.manager@demo.test')
    res = await importTemplateRoute(req('/api/students/import-template'))
    expect(res.status).toBe(200)
    // compared as bytes: the template starts with a UTF-8 byte-order mark (for Excel), which Response.text() would strip
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new TextEncoder().encode(importTemplateCsv()))
    expect(importTemplateCsv().charCodeAt(0)).toBe(0xfeff)
    expect(H(res, ['content-type', 'content-disposition', 'cache-control'])).toEqual({
      'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="student-import-template.csv"', 'cache-control': 'no-store',
    })
  })
})

describe('GET /api/reports/[key]', () => {
  it('signed out: 404 "Not found" without a cache header', async () => {
    signOut()
    const res = await reportRoute(req('/api/reports/by-stage'), params({ key: 'by-stage' }))
    expect([res.status, await res.text(), res.headers.get('cache-control')]).toEqual([404, 'Not found', null])
  })

  it('unknown report: 404 with the service message, no-store', async () => {
    await signIn('edx.manager@demo.test')
    const res = await reportRoute(req('/api/reports/no-such-report'), params({ key: 'no-such-report' }))
    expect([res.status, await res.text(), res.headers.get('cache-control')]).toEqual([404, 'Report not found.', 'no-store'])
  })

  it('allowed: CSV attachment, no-store', async () => {
    await signIn('edx.manager@demo.test')
    const res = await reportRoute(req('/api/reports/by-stage'), params({ key: 'by-stage' }))
    expect(res.status).toBe(200)
    expect((await res.text()).split('\n')[0]).toMatch(/Stage/)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[^"]+\.csv"$/)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('not allowed to export: the current status and message are recorded', async () => {
    await signIn('edx.counsellor@demo.test')
    const res = await reportRoute(req('/api/reports/by-stage'), params({ key: 'by-stage' }))
    expect({ status: res.status, body: await res.text(), cache: res.headers.get('cache-control') }).toMatchInlineSnapshot(`
      {
        "body": "Report not found.",
        "cache": "no-store",
        "status": 404,
      }
    `)
  })
})

describe('POST /api/students/[id]/merge', () => {
  let d: Awaited<ReturnType<typeof uploadedDocument>>
  beforeAll(async () => { d = await uploadedDocument() })
  const form = (fields: Record<string, string | string[]>) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x)
    return fd
  }
  const post = (studentId: string, fd: FormData, headers: Record<string, string>) =>
    mergeRoute(req(`/api/students/${studentId}/merge`, { method: 'POST', body: fd, headers }), params({ id: studentId }))

  it('signed out: 404 "Not found" (checked before the Origin rule)', async () => {
    signOut()
    const res = await post(d.studentId, form({}), {})
    expect([res.status, await res.text()]).toEqual([404, 'Not found'])
  })

  it('Origin rule (exists today): missing Origin, or Origin host different from Host → 403 "Forbidden"', async () => {
    await signIn('docs@demo.test')
    for (const headers of [{ host: 'localhost' }, { origin: 'http://evil.example', host: 'localhost' }] as Record<string, string>[]) {
      const res = await post(d.studentId, form({ mode: 'preview', purpose: 'general', files: d.fileId }), headers)
      expect([res.status, await res.text()]).toEqual([403, 'Forbidden'])
    }
  })

  it('same origin, invalid selection: 422 text/plain with the service message, no-store', async () => {
    await signIn('docs@demo.test')
    const res = await post(d.studentId, form({ mode: 'preview', purpose: 'general' }), { origin: 'http://localhost', host: 'localhost' })
    expect({ status: res.status, body: await res.text(), type: res.headers.get('content-type'), cache: res.headers.get('cache-control') }).toMatchInlineSnapshot(`
      {
        "body": "Select at least one document.",
        "cache": "no-store",
        "status": 422,
        "type": "text/plain; charset=utf-8",
      }
    `)
  })

  it('same origin, a file pdf-lib cannot read: 422 text/plain listing the file, nothing generated', async () => {
    await signIn('docs@demo.test')
    const res = await post(d.studentId, form({ mode: 'preview', purpose: 'general', allowUnapproved: 'yes', files: d.fileId }), { origin: 'http://localhost', host: 'localhost' })
    const body = new Uint8Array(await res.arrayBuffer())
    expect({
      status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), nosniff: res.headers.get('x-content-type-options'),
      disposition: res.headers.get('content-disposition')?.replace(/filename\*?=[^;]+/g, 'filename=<name>'),
      startsWithPdf: new TextDecoder().decode(body.slice(0, 5)) === '%PDF-', text: res.headers.get('content-type')?.startsWith('text/') ? new TextDecoder().decode(body) : undefined,
    }).toMatchInlineSnapshot(`
      {
        "cache": "no-store",
        "disposition": undefined,
        "nosniff": null,
        "startsWithPdf": false,
        "status": 422,
        "text": "The combined PDF was not generated.

      Some documents could not be added. Nothing was generated – correct the selection and try again.
      • Plus Two Certificate: The PDF is damaged or cannot be read.

      Go back, correct the selection and try again.",
        "type": "text/plain; charset=utf-8",
      }
    `)
  })
})

describe('POST /api/students/[id]/merge: success', () => {
  it('same origin, one readable PDF: 200 application/pdf, inline (preview) or attachment (download), private no-store, nosniff', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage([595.28, 841.89])
    const d = await uploadedDocument(new Uint8Array(await pdf.save()))
    await signIn('docs@demo.test')
    for (const mode of ['preview', 'download'] as const) {
      const fd = new FormData()
      for (const [k, v] of Object.entries({ mode, purpose: 'general', allowUnapproved: 'yes', files: d.fileId })) fd.append(k, v)
      const res = await mergeRoute(req(`/api/students/${d.studentId}/merge`, { method: 'POST', body: fd, headers: { origin: 'http://localhost', host: 'localhost' } }), params({ id: d.studentId }))
      const body = new Uint8Array(await res.arrayBuffer())
      expect(res.status, new TextDecoder().decode(body.slice(0, 300))).toBe(200)
      expect(new TextDecoder().decode(body.slice(0, 5))).toBe('%PDF-')
      expect(H(res, ['content-type', 'cache-control', 'x-content-type-options'])).toEqual({ 'content-type': 'application/pdf', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' })
      expect(res.headers.get('content-disposition')).toMatch(new RegExp(`^${mode === 'preview' ? 'inline' : 'attachment'}; filename="[\\x20-\\x7e]+"; filename\\*=UTF-8''\\S+$`))
    }
  })
})

describe('GET /portal/files/[id]', () => {
  it('no portal session: 404 "Not found" with no-store', async () => {
    signOut()
    const res = await portalFileRoute(req(`/portal/files/${UNKNOWN}`), params({ id: UNKNOWN }))
    expect([res.status, await res.text(), res.headers.get('cache-control')]).toEqual([404, 'Not found', 'no-store'])
  })
})

describe('cron routes: Bearer CRON_SECRET', () => {
  const SECRET = `contract-cron-${'x'.repeat(40)}`
  afterAll(() => { delete process.env.CRON_SECRET })

  it('no secret configured, missing, wrong or short secret: 404 "Not found" without a cache header', async () => {
    delete process.env.CRON_SECRET
    for (const route of [cronDaily, cronNotifications]) {
      const res = await route(req('/api/cron/daily', { headers: { authorization: `Bearer ${SECRET}` } }))
      expect([res.status, await res.text(), res.headers.get('cache-control')]).toEqual([404, 'Not found', null])
    }
    process.env.CRON_SECRET = 'short-secret'
    const short = await cronDaily(req('/api/cron/daily', { headers: { authorization: 'Bearer short-secret' } }))
    expect(short.status).toBe(404)
    process.env.CRON_SECRET = SECRET
    for (const auth of [undefined, 'Bearer wrong', SECRET]) {
      for (const route of [cronDaily, cronNotifications]) {
        const res = await route(req('/api/cron/daily', { headers: auth ? { authorization: auth } : {} }))
        expect([res.status, await res.text()]).toEqual([404, 'Not found'])
      }
    }
  })

  it('correct secret: 200 JSON with the current result fields, no-store', async () => {
    process.env.CRON_SECRET = SECRET
    const daily = await cronDaily(req('/api/cron/daily', { headers: { authorization: `Bearer ${SECRET}` } }))
    expect(daily.status).toBe(200)
    expect(daily.headers.get('cache-control')).toBe('no-store')
    expect(Object.keys(await daily.json()).sort()).toEqual(['authHousekeeping', 'authMessagesRemoved', 'emailVerificationsExpired', 'passportTasksCreated', 'portalLinkEmailsRemoved', 'virusScan'])
    const notif = await cronNotifications(req('/api/cron/notifications', { headers: { authorization: `Bearer ${SECRET}` } }))
    expect(notif.status).toBe(200)
    expect(notif.headers.get('cache-control')).toBe('no-store')
    const keys = Object.keys(await notif.json())
    for (const k of ['processed', 'securityAlerts', 'staffEmails', 'portalLinkEmails', 'authMessages']) expect(keys).toContain(k)
  })
})
