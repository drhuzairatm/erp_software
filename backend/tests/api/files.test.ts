/**
 * Stage 2 (files and photos): the real Express endpoints, in-process with the Express request context.
 * - concurrency: overlapping requests from different staff and client addresses to the real endpoints; each response
 *   belongs to its own user, and every audit row written by the database names the right person AND address
 * - the internal gate comes first: without the Next.js server's credential, the endpoints are unreachable
 * Contracts (status, body, headers) are covered through the Next.js routes in
 * frontend/tests/integration/contract-files-photos.test.ts.
 */
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => { process.env.DATABASE_POOL_SIZE = '3' })
vi.mock('@/lib/http/context-provider', async () => await import('../../src/lib/http/context-provider'))

import { login, SESSION_COOKIE } from '@/lib/auth/session'
import { anonymous, db } from '@/lib/db'
import * as documents from '@/services/documents'
import { saveStudentPhoto } from '@/services/photos'
import * as students from '@/services/students'
import { type RequestStore, requestStore } from '../../src/lib/http/context-provider'
import { adminSql, ctxFor, orgId } from '../support/helpers'
import { send, startApi } from './support'

let api: Awaited<ReturnType<typeof startApi>>
const tokens = new Map<string, string>()
let fileId: string; let studentId: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)

async function signIn(email: string) {
  const store: RequestStore = { headers: new Headers({ 'user-agent': 'vitest-files' }), cookies: new Map(), setCookies: [], ip: '192.0.2.1', origin: null, host: null }
  const r = await requestStore.run(store, () => login(email, process.env.SEED_DEMO_PASSWORD!))
  expect(r, email).toMatchObject({ ok: true, mfaPending: false })
  return store.cookies.get(SESSION_COOKIE)!
}

beforeAll(async () => {
  const EDX = await orgId('EDX')
  const mgr = await ctxFor('edx.manager@demo.test'); const docs = await ctxFor('docs@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Files Api Student', phone: `+91 90074 ${rand()}` })
  if (!r.ok) throw new Error('student not created')
  studentId = r.id
  await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
  const item = (await documents.getChecklist(mgr, r.id)).items.find((i) => i.type_key === 'plus_two_certificate')!
  await documents.uploadDocument(docs, item.id, new File([new TextEncoder().encode(`%PDF-1.4\n% api ${rand()}\n%%EOF`)], 'scan.pdf', { type: 'application/pdf' }))
  const [f] = await adminSql()`select f.id, f.storage_key from student_documents d join document_files f on f.id = d.current_file_id where d.id = ${item.id}`
  await anonymous((tx) => tx`select app.record_file_scan(${f.storage_key}, 'clean', 'ClamAV', null)`)
  fileId = f.id
  const jpeg = await sharp({ create: { width: 420, height: 540, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer()
  await saveStudentPhoto(mgr, studentId, new File([new Uint8Array(jpeg)], 'p.jpg', { type: 'image/jpeg' }), null)
  for (const e of ['docs@demo.test', 'edx.manager@demo.test', 'grd.manager@demo.test', 'grd.counsellor@demo.test']) tokens.set(e, await signIn(e))
  api = await startApi()
})
afterAll(async () => { await api.close(); await adminSql().end(); await db().end() })

describe('real file/photo endpoints under concurrency', () => {
  it('120 overlapping requests: each answer and each audit row (person + address) belongs to its own request', async () => {
    const [{ m }] = await adminSql()`select coalesce(max(id), 0) as m from audit_logs`
    const paths = [`/api/files/${fileId}/content`, `/api/files/${fileId}`, `/api/students/${studentId}/photo`, `/api/students/${studentId}/photo/download`]
    const emails = [...tokens.keys()]
    // expected status per person and endpoint: one request at a time first (the baseline)
    const expected: Record<string, number[]> = {}
    for (const email of emails) {
      expected[email] = []
      for (const p of paths) {
        const res = await send(api.base, { path: p, cookie: `${SESSION_COOKIE}=${tokens.get(email)}`, context: { ip: '192.0.2.50' } })
        await res.arrayBuffer()
        expected[email].push(res.status)
      }
    }
    // the baseline itself reflects company isolation: the other company's staff get 404 everywhere
    expect(expected['grd.manager@demo.test']).toEqual([404, 404, 404, 404])
    expect(expected['grd.counsellor@demo.test']).toEqual([404, 404, 404, 404])
    expect(expected['edx.manager@demo.test']).toEqual([200, 302, 200, 302])
    const reqs = Array.from({ length: 120 }, (_, i) => ({ email: emails[i % 4], kind: Math.floor(i / 4) % 4, ip: `198.51.100.${i + 1}` })).sort(() => Math.random() - 0.5)
    const results = await Promise.all(reqs.map(async (q) => {
      const res = await send(api.base, { path: paths[q.kind], cookie: `${SESSION_COOKIE}=${tokens.get(q.email)}`, context: { ip: q.ip } })
      await res.arrayBuffer()
      return { q, status: res.status }
    }))
    for (const { q, status } of results) expect(status, `${q.email} ${paths[q.kind]}`).toBe(expected[q.email][q.kind])

    const byIp = new Map(reqs.map((q) => [q.ip, q]))
    const rows = await adminSql()<{ action: string; outcome: string; email: string; request_ip: string }[]>`
      select a.action, a.outcome, u.email, a.request_ip from audit_logs a join user_profiles u on u.id = a.actor_user_id
       where a.id > ${m} and a.action in ('file_access', 'file_download', 'photo_download') and a.request_ip like '198.51.100.%'`
    // the database writes one audit row per file request and per photo-download request (granted or denied)
    const fileRequests = reqs.filter((q) => q.kind <= 1).length
    const photoDownloads = reqs.filter((q) => q.kind === 3).length
    expect(rows.length).toBe(fileRequests + photoDownloads)
    for (const r of rows) {
      const q = byIp.get(r.request_ip)!
      expect(r.email, r.request_ip).toBe(q.email)
      expect(r.action).toBe(['file_access', 'file_download', '', 'photo_download'][q.kind])
      expect(r.outcome, `${q.email} ${paths[q.kind]}`).toBe(expected[q.email][q.kind] === 404 ? 'denied' : 'success')
    }
  })

  it('without the Next.js server\'s credential the endpoints are unreachable (empty 404 from the gate, nothing audited)', async () => {
    const [{ m }] = await adminSql()`select coalesce(max(id), 0) as m from audit_logs`
    for (const path of [`/api/files/${fileId}`, `/api/files/${fileId}/content`, `/api/students/${studentId}/photo`, '/api/storage/local']) {
      const res = await send(api.base, { path, cookie: `${SESSION_COOKIE}=${tokens.get('docs@demo.test')}` }, null)
      expect([res.status, await res.text()], path).toEqual([404, ''])
    }
    const [{ n }] = await adminSql()`select count(*)::int as n from audit_logs where id > ${m} and entity_id = ${fileId}`
    expect(n).toBe(0)
  })

  it('a session cookie that was not signed for this request is refused (cookie bound into the credential)', async () => {
    const res = await send(api.base, { path: `/api/files/${fileId}/content`, extraHeaders: { cookie: `${SESSION_COOKIE}=${tokens.get('docs@demo.test')}` } })
    expect([res.status, await res.text()]).toEqual([404, ''])
  })
})
