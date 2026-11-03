/**
 * Contracts of the read-only file and photo routes (Stage 2 slice: files and photos), recorded against the route
 * handlers BEFORE they were moved to the Express API, and required to stay identical afterwards (then: browser request →
 * Next.js route handler → signed BFF call → Express API in a separate process → controller → service → repository).
 *
 *   GET /api/files/[id]                 302 to a 60-second signed link (documents.download), audited
 *   GET /api/files/[id]/content         bytes for the in-app viewer (documents.file.view), audited
 *   GET /api/storage/local              signed-link file server (local storage driver)
 *   GET /api/students/[id]/photo        thumbnail / portrait
 *   GET /api/students/[id]/photo/download   302 to a signed link, audited
 *   GET /api/staff/[id]/photo           thumbnail / display
 *
 * The browser's request carries the session cookie (Cookie header) and, where tested, X-Real-IP. The same values are
 * also given to the simulated next/headers, which the route handlers read before the move. Uses only the throwaway
 * test database (.data/pg-test, port 54339) and test storage (.data/storage-test).
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

import sharp from 'sharp'
import { GET as fileContentRoute } from '@/app/api/files/[id]/content/route'
import { GET as fileRoute } from '@/app/api/files/[id]/route'
import { GET as staffPhotoRoute } from '@/app/api/staff/[id]/photo/route'
import { GET as storageLocalRoute } from '@/app/api/storage/local/route'
import { GET as photoDownloadRoute } from '@/app/api/students/[id]/photo/download/route'
import { GET as photoRoute } from '@/app/api/students/[id]/photo/route'
import { login } from '@/lib/auth/session'
import { anonymous, db } from '@/lib/db'
import * as documents from '@/services/documents'
import { saveStudentPhoto } from '@/services/photos'
import { saveStaffPhoto } from '@/services/staff-photos'
import * as students from '@/services/students'
import { signLocal } from '@/lib/storage'
import { adminSql, ctxFor, orgId } from '../../../backend/tests/support/helpers'
import { startApiProcess } from './support/api-process'

type Route = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
const UNKNOWN = '00000000-0000-4000-8000-000000000000'
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const STAFF = ['docs@demo.test', 'edx.manager@demo.test', 'edx.counsellor@demo.test', 'grd.manager@demo.test', 'grd.counsellor@demo.test', 'md@demo.test', 'ceo@demo.test', 'admin@demo.test']
let EDX: string
let api: Awaited<ReturnType<typeof startApiProcess>>

/** What the browser sends: the cookies of the simulated jar, plus optional extra headers (also given to next/headers). */
function browserRequest(url: string, extra: Record<string, string> = {}) {
  currentHeaders = new Headers({ 'user-agent': 'vitest-contract', ...extra })
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  return new Request(`http://localhost${url}`, { headers: { 'user-agent': 'vitest-contract', ...(cookie ? { cookie } : {}), ...extra } })
}
const call = (route: Route, url: string, id: string, extra?: Record<string, string>) => route(browserRequest(url, extra), { params: Promise.resolve({ id }) })

async function signIn(email: string) {
  jar = new Map()
  currentHeaders = new Headers({ 'user-agent': 'vitest-contract' })
  const r = await login(email, process.env.SEED_DEMO_PASSWORD!)
  expect(r, `sign-in ${email}`).toMatchObject({ ok: true, mfaPending: false, mustChangePassword: false })
}
const signOut = () => { jar = new Map() }

/** All response headers except Content-Length (framing; reported separately), as a sorted plain object. */
const allHeaders = (res: Response) => Object.fromEntries([...res.headers].filter(([k]) => k !== 'content-length').sort(([a], [b]) => a.localeCompare(b)))
const masked = (h: Record<string, string>) => ({ ...h, ...(h.location ? { location: '<signed link>' } : {}) })
const summary = async (res: Response) => {
  const bytes = new Uint8Array(await res.arrayBuffer())
  const text = res.headers.get('content-type')?.startsWith('text/') ? new TextDecoder().decode(bytes) : `<${bytes.byteLength > 0 ? 'bytes' : 'empty'}>`
  return { status: res.status, body: text, headers: masked(allHeaders(res)) }
}

async function uploadedDocument(opts: { scan?: 'clean' | 'infected' } = {}) {
  const mgr = await ctxFor('edx.manager@demo.test'); const docs = await ctxFor('docs@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Files Contract Student', phone: `+91 90071 ${rand()}` })
  if (!r.ok) throw new Error('student not created')
  await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
  const item = (await documents.getChecklist(mgr, r.id)).items.find((i) => i.type_key === 'plus_two_certificate')!
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% fictional files contract ${rand()}\n%%EOF`)
  await documents.uploadDocument(docs, item.id, new File([bytes], 'Scan "final" <1>.pdf', { type: 'application/pdf' }))
  const [f] = await adminSql()`select f.id, f.storage_key from student_documents d join document_files f on f.id = d.current_file_id where d.id = ${item.id}`
  await anonymous((tx) => tx`select app.record_file_scan(${f.storage_key}, ${opts.scan ?? 'clean'}, 'ClamAV', null)`)
  return { studentId: r.id, fileId: f.id as string, storageKey: f.storage_key as string, bytes }
}

/** The newest audit row id: rows written after this are the ones the requests in a test caused. */
const auditMark = async () => Number((await adminSql()<{ m: string }[]>`select coalesce(max(id), 0) as m from audit_logs`)[0].m)
const auditRows = async (entityId: string, after: number) => (await adminSql()<{ action: string; outcome: string; email: string | null; request_ip: string | null; reason: string | null }[]>`
  select a.action, a.outcome, u.email, a.request_ip, a.metadata ->> 'reason' as reason
    from audit_logs a left join user_profiles u on u.id = a.actor_user_id
   where a.entity_id = ${entityId} and a.id > ${after} order by a.id`).map((r) => ({ ...r }))

beforeAll(async () => {
  EDX = await orgId('EDX')
  api = await startApiProcess()
})
afterAll(async () => { await api.close(); await adminSql().end(); await db().end() })

describe('GET /api/files/[id] and /api/files/[id]/content', () => {
  let d: Awaited<ReturnType<typeof uploadedDocument>>
  beforeAll(async () => { d = await uploadedDocument() })

  it('signed out: 404 "Not found", text/plain, no cache header', async () => {
    signOut()
    for (const [route, url] of [[fileRoute, `/api/files/${d.fileId}`], [fileContentRoute, `/api/files/${d.fileId}/content`]] as const) {
      expect(await summary(await call(route, url, d.fileId))).toEqual({ status: 404, body: 'Not found', headers: { 'content-type': 'text/plain;charset=UTF-8' } })
    }
  })

  it('signed in: malformed or unknown id → 404 "Not found" no-store', async () => {
    await signIn('docs@demo.test')
    // '.', '..' and 'a/b' added in Stage 2 (path-segment encoding in the BFF); the unchanged services reject them as non-UUIDs
    for (const id of ['not-a-uuid', UNKNOWN, `${d.fileId.slice(0, 35)}g`, '.', '..', 'a/b', '%']) {
      for (const [route, url] of [[fileRoute, `/api/files/${id}`], [fileContentRoute, `/api/files/${id}/content`]] as const) {
        expect(await summary(await call(route, url, id)), id).toEqual({ status: 404, body: 'Not found', headers: { 'cache-control': 'no-store', 'content-type': 'text/plain;charset=UTF-8' } })
      }
    }
  })

  it('permission matrix (company isolation, roles): status of open / content for each demo account', async () => {
    const matrix: Record<string, [number, number]> = {}
    for (const email of STAFF) {
      await signIn(email)
      const open = await call(fileRoute, `/api/files/${d.fileId}`, d.fileId)
      const content = await call(fileContentRoute, `/api/files/${d.fileId}/content`, d.fileId)
      matrix[email] = [open.status, content.status]
      await open.arrayBuffer(); await content.arrayBuffer()
    }
    expect(matrix).toMatchInlineSnapshot(`
      {
        "admin@demo.test": [
          404,
          404,
        ],
        "ceo@demo.test": [
          404,
          404,
        ],
        "docs@demo.test": [
          302,
          200,
        ],
        "edx.counsellor@demo.test": [
          404,
          404,
        ],
        "edx.manager@demo.test": [
          302,
          200,
        ],
        "grd.counsellor@demo.test": [
          404,
          404,
        ],
        "grd.manager@demo.test": [
          404,
          404,
        ],
        "md@demo.test": [
          404,
          404,
        ],
      }
    `)
  })

  it('open allowed: 302, empty body, exactly Location + no-store + no-referrer; the link is signed for this file', async () => {
    await signIn('docs@demo.test')
    const res = await call(fileRoute, `/api/files/${d.fileId}`, d.fileId)
    const location = res.headers.get('location')!
    expect(await summary(res)).toEqual({ status: 302, body: '<empty>', headers: { 'cache-control': 'no-store', location: '<signed link>', 'referrer-policy': 'no-referrer' } })
    const u = new URL(location, 'http://localhost')
    expect([u.pathname, [...u.searchParams.keys()].sort(), u.searchParams.get('k'), u.searchParams.get('t'), u.searchParams.get('f')])
      .toEqual(['/api/storage/local', ['e', 'f', 'k', 's', 't'], d.storageKey, 'application/pdf', 'Scan _final_ _1_.pdf']) // stored name, already sanitised at upload
    const exp = Number(u.searchParams.get('e'))
    expect(exp - Date.now() / 1000).toBeGreaterThan(50)
    expect(exp - Date.now() / 1000).toBeLessThanOrEqual(61)
  })

  it('content allowed: 200, exact bytes, exactly the viewer headers', async () => {
    await signIn('docs@demo.test')
    const res = await call(fileContentRoute, `/api/files/${d.fileId}/content`, d.fileId)
    expect(res.status).toBe(200)
    expect(allHeaders(res)).toEqual({
      'cache-control': 'private, no-store', 'content-disposition': 'inline', 'content-security-policy': "default-src 'none'; sandbox",
      'content-type': 'application/pdf', 'x-content-type-options': 'nosniff',
    })
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(d.bytes)
  })

  it('every access is audited by the database, with the client address from the trusted proxy (TRUST_PROXY=x-real-ip)', async () => {
    vi.stubEnv('TRUST_PROXY', 'x-real-ip')
    try {
      const since = await auditMark()
      await signIn('docs@demo.test')
      await (await call(fileRoute, `/api/files/${d.fileId}`, d.fileId, { 'x-real-ip': '198.51.100.21' })).arrayBuffer()
      await (await call(fileContentRoute, `/api/files/${d.fileId}/content`, d.fileId, { 'x-real-ip': '198.51.100.22', 'x-forwarded-for': '203.0.113.99' })).arrayBuffer()
      await signIn('grd.manager@demo.test')
      await (await call(fileContentRoute, `/api/files/${d.fileId}/content`, d.fileId, { 'x-real-ip': '198.51.100.23' })).arrayBuffer()
      expect(await auditRows(d.fileId, since)).toMatchInlineSnapshot(`
        [
          {
            "action": "file_download",
            "email": "docs@demo.test",
            "outcome": "success",
            "reason": null,
            "request_ip": "198.51.100.21",
          },
          {
            "action": "file_access",
            "email": "docs@demo.test",
            "outcome": "success",
            "reason": null,
            "request_ip": "198.51.100.22",
          },
          {
            "action": "file_access",
            "email": "grd.manager@demo.test",
            "outcome": "denied",
            "reason": null,
            "request_ip": "198.51.100.23",
          },
        ]
      `)
    } finally { vi.unstubAllEnvs() }
  })

  it('quarantine: an infected file is never served (404 no-store, audited as denied: quarantined)', async () => {
    const q = await uploadedDocument({ scan: 'infected' })
    const since = await auditMark()
    await signIn('docs@demo.test')
    for (const [route, url] of [[fileRoute, `/api/files/${q.fileId}`], [fileContentRoute, `/api/files/${q.fileId}/content`]] as const) {
      expect(await summary(await call(route, url, q.fileId))).toEqual({ status: 404, body: 'Not found', headers: { 'cache-control': 'no-store', 'content-type': 'text/plain;charset=UTF-8' } })
    }
    expect((await auditRows(q.fileId, since)).map((r) => [r.action, r.outcome, r.reason])).toMatchInlineSnapshot(`
      [
        [
          "file_download",
          "denied",
          "quarantined",
        ],
        [
          "file_access",
          "denied",
          "quarantined",
        ],
      ]
    `)
  })
})

describe('GET /api/storage/local (signed links)', () => {
  let d: Awaited<ReturnType<typeof uploadedDocument>>
  beforeAll(async () => { d = await uploadedDocument() })
  const link = (o: { key?: string; exp?: number; filename?: string; type?: string; sig?: string } = {}) => {
    const key = o.key ?? d.storageKey; const exp = o.exp ?? Math.floor(Date.now() / 1000) + 60
    const filename = o.filename ?? 'Scan.pdf'; const type = o.type ?? 'application/pdf'
    const q = new URLSearchParams({ k: key, e: String(exp), f: filename, t: type, s: o.sig ?? signLocal(key, exp, filename, type) })
    return `/api/storage/local?${q}`
  }
  const get = (url: string) => storageLocalRoute(browserRequest(url))

  it('valid link, no session needed: 200, exact bytes, exactly the file headers; the filename is sanitised', async () => {
    signOut()
    const res = await get(link({ filename: 'Scan "final" <1>;x.pdf' }))
    expect(res.status).toBe(200)
    expect(allHeaders(res)).toEqual({
      'cache-control': 'private, no-store', 'content-disposition': 'inline; filename="Scan _final_ _1__x.pdf"',
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", 'content-type': 'application/pdf',
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    })
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(d.bytes)
  })

  it('tampered, expired, unsigned, or a type outside the allow-list: 403 "Link expired or invalid" no-store', async () => {
    const expired = Math.floor(Date.now() / 1000) - 1
    const cases = {
      tampered: link({ sig: 'x'.repeat(64) }),
      expired: link({ exp: expired }),
      otherKey: link().replace(encodeURIComponent(d.storageKey), encodeURIComponent(`${d.storageKey}x`)),
      html: link({ type: 'text/html' }),
      noParams: '/api/storage/local',
    }
    for (const [name, url] of Object.entries(cases)) {
      expect(await summary(await get(url)), name).toEqual({ status: 403, body: 'Link expired or invalid', headers: { 'cache-control': 'no-store', 'content-type': 'text/plain;charset=UTF-8' } })
    }
  })

  it('validly signed link to a missing file: 404 "Not found" without a cache header', async () => {
    expect(await summary(await get(link({ key: `${d.storageKey}-missing` })))).toEqual({ status: 404, body: 'Not found', headers: { 'content-type': 'text/plain;charset=UTF-8' } })
  })
})

describe('GET /api/students/[id]/photo and /photo/download', () => {
  let studentId: string; let noPhotoId: string
  beforeAll(async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Files Photo Student', phone: `+91 90072 ${rand()}` })
    const n = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Files No Photo', phone: `+91 90073 ${rand()}` })
    if (!r.ok || !n.ok) throw new Error('student not created')
    studentId = r.id; noPhotoId = n.id
    const jpeg = await sharp({ create: { width: 420, height: 540, channels: 3, background: { r: 120, g: 140, b: 160 } } }).jpeg().toBuffer()
    await saveStudentPhoto(mgr, studentId, new File([new Uint8Array(jpeg)], 'photo.jpg', { type: 'image/jpeg' }), null)
  })

  it('signed out: 404 "Not found" without a cache header (both routes)', async () => {
    signOut()
    for (const [route, url] of [[photoRoute, `/api/students/${studentId}/photo`], [photoDownloadRoute, `/api/students/${studentId}/photo/download`]] as const) {
      expect(await summary(await call(route, url, studentId))).toEqual({ status: 404, body: 'Not found', headers: { 'content-type': 'text/plain;charset=UTF-8' } })
    }
  })

  it('thumb (default and any other size value) and portrait: 200 JPEG, exactly the image headers; distinct variants', async () => {
    await signIn('edx.manager@demo.test')
    const bodies: Record<string, Uint8Array> = {}
    for (const q of ['', '?size=thumb', '?size=bogus', '?size=PORTRAIT', '?size=portrait', '?size=thumb&size=portrait', '?size=portrait&size=thumb', '?size=por%74rait']) {
      const res = await call(photoRoute, `/api/students/${studentId}/photo${q}`, studentId)
      expect(res.status, q).toBe(200)
      expect(allHeaders(res), q).toEqual({ 'cache-control': 'private, max-age=300', 'content-security-policy': "default-src 'none'", 'content-type': 'image/jpeg', 'x-content-type-options': 'nosniff' })
      bodies[q] = new Uint8Array(await res.arrayBuffer())
    }
    expect(bodies['?size=thumb']).toEqual(bodies[''])
    expect(bodies['?size=bogus']).toEqual(bodies[''])
    expect(bodies['?size=PORTRAIT']).toEqual(bodies['']) // exact match only
    expect(bodies['?size=portrait']).not.toEqual(bodies[''])
    // repeated parameter: the FIRST value counts; percent-encoding is decoded
    expect(bodies['?size=thumb&size=portrait']).toEqual(bodies[''])
    expect(bodies['?size=portrait&size=thumb']).toEqual(bodies['?size=portrait'])
    expect(bodies['?size=por%74rait']).toEqual(bodies['?size=portrait'])
    expect((await sharp(Buffer.from(bodies[''])).metadata()).width).toBe(256)
  })

  it('download: 302, exactly Location + no-store + no-referrer; link named Name_StudentID_PassportPhoto.jpg; audited', async () => {
    const since = await auditMark()
    await signIn('edx.manager@demo.test')
    const res = await call(photoDownloadRoute, `/api/students/${studentId}/photo/download`, studentId)
    const location = res.headers.get('location')!
    expect(await summary(res)).toEqual({ status: 302, body: '<empty>', headers: { 'cache-control': 'no-store', location: '<signed link>', 'referrer-policy': 'no-referrer' } })
    const [s] = await adminSql()`select student_code from students where id = ${studentId}`
    const u = new URL(location, 'http://localhost')
    expect([u.pathname, u.searchParams.get('f'), u.searchParams.get('t')]).toEqual(['/api/storage/local', `FilesPhotoStudent_${s.student_code}_PassportPhoto.jpg`, 'image/jpeg'])
    const file = await storageLocalRoute(browserRequest(`${u.pathname}${u.search}`))
    expect([file.status, file.headers.get('content-type')]).toEqual([200, 'image/jpeg'])
    await file.arrayBuffer()
    expect((await adminSql()`select action, outcome from audit_logs where student_id = ${studentId} and id > ${since} order by id`).map((r) => [r.action, r.outcome])).toMatchInlineSnapshot(`
      [
        [
          "photo_download",
          "success",
        ],
      ]
    `)
  })

  it('permission matrix: status of thumb / download for each demo account', async () => {
    const matrix: Record<string, [number, number]> = {}
    for (const email of STAFF) {
      await signIn(email)
      const a = await call(photoRoute, `/api/students/${studentId}/photo`, studentId)
      const b = await call(photoDownloadRoute, `/api/students/${studentId}/photo/download`, studentId)
      matrix[email] = [a.status, b.status]
      await a.arrayBuffer(); await b.arrayBuffer()
    }
    expect(matrix).toMatchInlineSnapshot(`
      {
        "admin@demo.test": [
          404,
          404,
        ],
        "ceo@demo.test": [
          404,
          404,
        ],
        "docs@demo.test": [
          404,
          404,
        ],
        "edx.counsellor@demo.test": [
          200,
          302,
        ],
        "edx.manager@demo.test": [
          200,
          302,
        ],
        "grd.counsellor@demo.test": [
          404,
          404,
        ],
        "grd.manager@demo.test": [
          404,
          404,
        ],
        "md@demo.test": [
          404,
          404,
        ],
      }
    `)
  })

  it('signed in: no photo, unknown, malformed id, or other company → 404 "Not found" no-store (both routes)', async () => {
    const notFound = { status: 404, body: 'Not found', headers: { 'cache-control': 'no-store', 'content-type': 'text/plain;charset=UTF-8' } }
    await signIn('edx.manager@demo.test')
    for (const id of [noPhotoId, UNKNOWN, 'x', '..', 'a/b']) {
      expect(await summary(await call(photoRoute, `/api/students/${id}/photo`, id)), id).toEqual(notFound)
      expect(await summary(await call(photoDownloadRoute, `/api/students/${id}/photo/download`, id)), id).toEqual(notFound)
    }
    await signIn('grd.manager@demo.test')
    expect(await summary(await call(photoRoute, `/api/students/${studentId}/photo?size=portrait`, studentId))).toEqual(notFound)
  })
})

describe('GET /api/staff/[id]/photo', () => {
  let owner: string
  beforeAll(async () => {
    const me = await ctxFor('edx.counsellor@demo.test')
    owner = me.userId
    const jpeg = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 60, g: 90, b: 120 } } }).jpeg().toBuffer()
    await saveStaffPhoto(me, owner, new File([new Uint8Array(jpeg)], 'me.jpg', { type: 'image/jpeg' }), null)
  })

  it('signed out: 404 "Not found" without a cache header', async () => {
    signOut()
    expect(await summary(await call(staffPhotoRoute, `/api/staff/${owner}/photo`, owner))).toEqual({ status: 404, body: 'Not found', headers: { 'content-type': 'text/plain;charset=UTF-8' } })
  })

  it('thumb (default / other values) and display: 200, exactly the image headers (always image/jpeg)', async () => {
    await signIn('edx.counsellor@demo.test')
    const sizes: Record<string, number> = {}
    for (const q of ['', '?size=bogus', '?size=display', '?size=thumb&size=display', '?size=display&size=thumb']) {
      const res = await call(staffPhotoRoute, `/api/staff/${owner}/photo${q}`, owner)
      expect(res.status, q).toBe(200)
      expect(allHeaders(res), q).toEqual({ 'cache-control': 'private, max-age=300', 'content-security-policy': "default-src 'none'", 'content-type': 'image/jpeg', 'x-content-type-options': 'nosniff' })
      sizes[q] = (await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width!
    }
    expect(sizes['']).toBe(256)
    expect(sizes['?size=bogus']).toBe(256)
    expect(sizes['?size=display']).toBeGreaterThan(256)
    expect(sizes['?size=thumb&size=display']).toBe(256)
    expect(sizes['?size=display&size=thumb']).toBe(sizes['?size=display'])
  })

  it('permission matrix (colleagues sharing a company): status for each demo account', async () => {
    const matrix: Record<string, number> = {}
    for (const email of STAFF) {
      await signIn(email)
      const r = await call(staffPhotoRoute, `/api/staff/${owner}/photo`, owner)
      matrix[email] = r.status
      await r.arrayBuffer()
    }
    expect(matrix).toMatchInlineSnapshot(`
      {
        "admin@demo.test": 404,
        "ceo@demo.test": 404,
        "docs@demo.test": 200,
        "edx.counsellor@demo.test": 200,
        "edx.manager@demo.test": 200,
        "grd.counsellor@demo.test": 404,
        "grd.manager@demo.test": 404,
        "md@demo.test": 404,
      }
    `)
  })

  it('signed in: unknown, malformed id or no photo → 404 "Not found" no-store', async () => {
    await signIn('edx.manager@demo.test')
    const nobody = (await ctxFor('grd.counsellor@demo.test')).userId
    for (const id of [UNKNOWN, 'x', nobody, '..', '.']) {
      expect(await summary(await call(staffPhotoRoute, `/api/staff/${id}/photo`, id)), id).toEqual({ status: 404, body: 'Not found', headers: { 'cache-control': 'no-store', 'content-type': 'text/plain;charset=UTF-8' } })
    }
  })
})

describe('permissions behind the MFA gate (API process with MFA_ENFORCE=off: every session fully active)', () => {
  // With the test setting MFA_ENFORCE=roles the MD, CEO and system admin have not set up two-step sign-in, so the routes
  // answer 404 before any permission check (recorded above). Here the permission decision itself is compared: for every
  // account, each route answers exactly what the (unchanged) service decides in-process for the same person.
  let mfaOff: Awaited<ReturnType<typeof startApiProcess>>
  let d: Awaited<ReturnType<typeof uploadedDocument>>; let studentId: string; let owner: string
  beforeAll(async () => {
    d = await uploadedDocument()
    const mgr = await ctxFor('edx.manager@demo.test')
    const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Files Gate Student', phone: `+91 90075 ${rand()}` })
    if (!r.ok) throw new Error('student not created')
    studentId = r.id
    const jpeg = await sharp({ create: { width: 420, height: 540, channels: 3, background: { r: 9, g: 9, b: 9 } } }).jpeg().toBuffer()
    await saveStudentPhoto(mgr, studentId, new File([new Uint8Array(jpeg)], 'p.jpg', { type: 'image/jpeg' }), null)
    const me = await ctxFor('grd.manager@demo.test'); owner = me.userId
    const sq = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 5, g: 5, b: 5 } } }).jpeg().toBuffer()
    await saveStaffPhoto(me, owner, new File([new Uint8Array(sq)], 'me.jpg', { type: 'image/jpeg' }), null)
    mfaOff = await startApiProcess({ MFA_ENFORCE: 'off' })
  })
  afterAll(async () => { await mfaOff.close() })

  it('route status = service decision, for all eight accounts and five routes', async () => {
    const { fileContent, openFile } = documents
    const { studentPhotoBytes, studentPhotoDownloadUrl } = await import('@/services/photos')
    const { staffPhotoBytes } = await import('@/services/staff-photos')
    const seen: Record<string, number[]> = {}
    for (const email of STAFF) {
      const ctx = await ctxFor(email)
      const expected = [
        (await openFile(ctx, d.fileId)) ? 302 : 404,
        (await fileContent(ctx, d.fileId)) ? 200 : 404,
        (await studentPhotoBytes(ctx, studentId, 'thumb')) ? 200 : 404,
        (await studentPhotoDownloadUrl(ctx, studentId)) ? 302 : 404,
        (await staffPhotoBytes(ctx, owner, 'thumb')) ? 200 : 404,
      ]
      await signIn(email)
      const got: number[] = []
      for (const [route, url, id] of [[fileRoute, `/api/files/${d.fileId}`, d.fileId], [fileContentRoute, `/api/files/${d.fileId}/content`, d.fileId],
        [photoRoute, `/api/students/${studentId}/photo`, studentId], [photoDownloadRoute, `/api/students/${studentId}/photo/download`, studentId],
        [staffPhotoRoute, `/api/staff/${owner}/photo`, owner]] as [Route, string, string][]) {
        const res = await call(route, url, id)
        got.push(res.status); await res.arrayBuffer()
      }
      expect(got, email).toEqual(expected)
      seen[email] = got
    }
    // [open, content, student photo, photo download, staff photo] — recorded for the report
    expect(seen).toMatchInlineSnapshot(`
      {
        "admin@demo.test": [
          404,
          404,
          404,
          404,
          200,
        ],
        "ceo@demo.test": [
          404,
          404,
          200,
          302,
          200,
        ],
        "docs@demo.test": [
          302,
          200,
          404,
          404,
          404,
        ],
        "edx.counsellor@demo.test": [
          404,
          404,
          200,
          302,
          404,
        ],
        "edx.manager@demo.test": [
          302,
          200,
          200,
          302,
          404,
        ],
        "grd.counsellor@demo.test": [
          404,
          404,
          404,
          404,
          200,
        ],
        "grd.manager@demo.test": [
          404,
          404,
          404,
          404,
          200,
        ],
        "md@demo.test": [
          302,
          200,
          200,
          302,
          200,
        ],
      }
    `)
  })
})

describe('internal API unavailable (decision D6)', () => {
  it('every proxied file/photo route answers 502, empty, no-store (proves the requests above went through the API process)', async () => {
    await signIn('docs@demo.test')
    await api.close()
    process.env.API_INTERNAL_URL = api.base // the stopped process's address
    try {
      const cases: [Route, string][] = [[fileRoute, `/api/files/${UNKNOWN}`], [fileContentRoute, `/api/files/${UNKNOWN}/content`], [photoRoute, `/api/students/${UNKNOWN}/photo`],
        [photoDownloadRoute, `/api/students/${UNKNOWN}/photo/download`], [staffPhotoRoute, `/api/staff/${UNKNOWN}/photo`]]
      for (const [route, url] of cases) {
        expect(await summary(await call(route, url, UNKNOWN)), url).toEqual({ status: 502, body: '<empty>', headers: { 'cache-control': 'no-store' } })
      }
      expect(await summary(await storageLocalRoute(browserRequest('/api/storage/local')))).toEqual({ status: 502, body: '<empty>', headers: { 'cache-control': 'no-store' } })
    } finally { delete process.env.API_INTERNAL_URL }
  })
})
