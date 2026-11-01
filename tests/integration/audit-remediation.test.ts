/**
 * Audit remediation H-1 (quarantine in the in-app viewer, incl. the real /api/files/{id}/content route handler)
 * and M-2 (bulk-access alerts for views, downloads and portal downloads). Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/services/base'

// The route handler resolves the signed-in user through getActiveSession(); the test supplies the user directly.
let currentCtx: Ctx | null = null
vi.mock('@/server/auth/session', async (orig) => ({ ...(await orig<typeof import('@/server/auth/session')>()), getActiveSession: async () => currentCtx }))

import { GET as viewerRoute } from '@/app/api/files/[id]/content/route'
import { anonymous, db } from '@/server/db'
import { ServiceError } from '@/server/errors'
import * as documents from '@/server/services/documents'
import * as pa from '@/server/services/portal-accounts'
import * as security from '@/server/services/security'
import * as students from '@/server/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId, securityClear } from '../support/helpers'

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const pdf = (t: string) => new File([new TextEncoder().encode(`%PDF-1.4\n% ${t}\n%%EOF`)], 'scan.pdf', { type: 'application/pdf' })
beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); return }
  throw new Error('expected ServiceError')
}
/** A student with one uploaded document; returns the file id and its storage key (key read with the admin connection). */
async function uploaded(key = 'plus_two_certificate', assignTo = 'docs@demo.test') {
  const mgr = await ctxFor('edx.manager@demo.test'); const docs = await ctxFor(assignTo)
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Remediation Student', phone: `+91 90053 ${rand()}` })
  if (!r.ok) throw new Error()
  await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
  const item = (await documents.getChecklist(mgr, r.id)).items.find((i) => i.type_key === key)!
  await documents.uploadDocument(docs, item.id, pdf(`fictional ${rand()}`))
  const [f] = await adminSql()`select f.id, f.storage_key from student_documents d join document_files f on f.id = d.current_file_id where d.id = ${item.id}`
  return { studentId: r.id, docId: item.id, fileId: f.id as string, key: f.storage_key as string, mgr, docs }
}
/** The trusted server-side path that records a scanner result (what the scanner integration calls). */
const scanResult = (key: string, status: 'clean' | 'infected') => anonymous((tx) => tx`select app.record_file_scan(${key}, ${status}, 'ClamAV', ${status === 'infected' ? 'Fictional.Test.Signature' : null})`)
const callRoute = async (ctx: Ctx | null, fileId: string) => { currentCtx = ctx; return viewerRoute(new Request(`http://localhost/api/files/${fileId}/content`), { params: Promise.resolve({ id: fileId }) }) }

describe('H-1: quarantined files are never readable through the in-app viewer', () => {
  it('clean file: an authorised viewer gets the bytes, through the service and the real route handler', async () => {
    const u = await uploaded()
    await scanResult(u.key, 'clean')
    const f = await documents.fileContent(u.docs, u.fileId)
    expect(f?.data.toString('latin1')).toContain('%PDF-1.4')
    const res = await callRoute(u.docs, u.fileId)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
  })

  it('infected file: denied in the service, in the database function and by a direct API request; the denial is audited as quarantined', async () => {
    const u = await uploaded()
    await scanResult(u.key, 'infected')
    expect(await documents.fileContent(u.docs, u.fileId)).toBeNull()
    expect(await documents.fileContent(await ctxFor('md@demo.test'), u.fileId)).toBeNull() // not even the MD
    expect(await as('edx.manager@demo.test', (tx) => tx`select * from app.authorize_file_access(${u.fileId})`)).toHaveLength(0)
    const res = await callRoute(u.docs, u.fileId)
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('%PDF')
    const [a] = await adminSql()`select outcome, metadata from audit_logs where action = 'file_access' and entity_id = ${u.fileId} order by id desc limit 1`
    expect(a).toMatchObject({ outcome: 'denied', metadata: { reason: 'quarantined' } })
    // and every other path stays closed: download (also used by the combined-PDF merge), manual clearance, approval
    expect(await as('md@demo.test', (tx) => tx`select * from app.authorize_file_download(${u.fileId})`)).toHaveLength(0)
    await expectServiceError(security.clearFileManually(await ctxFor('md@demo.test'), u.fileId, 'Trying to release an infected file'))
    for (const q of (await documents.getDocumentReview(u.docs, u.docId))!.requirements.filter((x) => x.is_mandatory)) await documents.recordVerification(u.docs, u.docId, q.id, 'present')
    await documents.documentAction(u.docs, u.docId, 'verify'); await documents.documentAction(u.docs, u.docId, 'submit')
    await expectServiceError(documents.documentAction(u.mgr, u.docId, 'approve'))
  })

  it('unauthorised users get nothing for a clean file (other company, no view permission, signed out)', async () => {
    const u = await uploaded()
    await scanResult(u.key, 'clean')
    for (const e of ['grd.manager@demo.test', 'edx.counsellor@demo.test', 'admin@demo.test']) {
      expect(await documents.fileContent(await ctxFor(e), u.fileId), e).toBeNull()
      expect((await callRoute(await ctxFor(e), u.fileId)).status, e).toBe(404)
    }
    expect((await callRoute(null, u.fileId)).status).toBe(404)
  })

  it('manually cleared file: authorised viewing works and it stays labelled as MANUAL clearance; the uploader cannot clear their own file', async () => {
    const u = await uploaded()
    await adminSql()`insert into role_permissions (role_id, permission_key) select id, 'documents.security_clear' from roles where org_id = ${EDX} and key = 'documentation' on conflict do nothing`
    try { await expectServiceError(security.clearFileManually(u.docs, u.fileId, 'I uploaded it, clearing it myself')) }
    finally { await adminSql()`delete from role_permissions where permission_key = 'documents.security_clear' and role_id in (select id from roles where org_id = ${EDX} and key = 'documentation')` }
    await securityClear(u.docId)
    const [s] = await adminSql()`select scan_status, scan_engine, scanned_at from document_files where id = ${u.fileId}`
    expect(s).toEqual({ scan_status: 'manually_cleared', scan_engine: null, scanned_at: null })
    expect((await callRoute(u.docs, u.fileId)).status).toBe(200)
  })

  it('portal: a published file that is later found infected can no longer be downloaded by the student', async () => {
    const u = await uploaded()
    for (const q of (await documents.getDocumentReview(u.docs, u.docId))!.requirements.filter((x) => x.is_mandatory)) await documents.recordVerification(u.docs, u.docId, q.id, 'present')
    await documents.documentAction(u.docs, u.docId, 'verify'); await documents.documentAction(u.docs, u.docId, 'submit')
    await securityClear(u.docId)
    await documents.documentAction(u.mgr, u.docId, 'approve')
    const pub = await pa.publishDocument(u.mgr, u.docId, 'Approved copy (fictional)')
    const token = `rem-${rand()}-${Date.now()}`
    await adminSql()`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${token}, ${[u.studentId]}, ${u.studentId})`
    expect(await anonymous((tx) => tx`select * from app.portal_download(${token}, ${pub}, null)`)).toHaveLength(1)
    await scanResult(u.key, 'infected') // the daily re-scan finds malware in the manually cleared file
    expect(await anonymous((tx) => tx`select * from app.portal_download(${token}, ${pub}, null)`)).toHaveLength(0)
    expect(await documents.fileContent(u.docs, u.fileId)).toBeNull()
  })
})

describe('M-2: bulk-access alerts include views, downloads and portal downloads', () => {
  const alertFor = (kind: string, subject: string) => adminSql()`select severity, details, occurrences from security_alerts where kind = ${kind} and subject_key = ${subject}`

  it('repeated in-app VIEWS by one person raise the alert (threshold 100 per hour)', async () => {
    const u = await uploaded('tenth_certificate')
    await scanResult(u.key, 'clean')
    const viewer = await ctxFor('edx.manager@demo.test')
    await as('edx.manager@demo.test', async (tx) => { for (let i = 0; i < 100; i++) await tx`select * from app.authorize_file_access(${u.fileId})` })
    const [a] = await alertFor('bulk_downloads', `user:${viewer.userId}`)
    expect(a.severity).toBe('high')
    expect(a.details.views_last_hour).toBeGreaterThanOrEqual(100)
    expect(JSON.stringify(a.details)).not.toMatch(/%PDF|storage|scan\.pdf/) // no contents or file locations in the alert
  })

  it('views and downloads count together; repeated staff DOWNLOADS raise the alert', async () => {
    const u = await uploaded('birth_certificate')
    await scanResult(u.key, 'clean')
    const md = await ctxFor('md@demo.test')
    await as('md@demo.test', async (tx) => {
      for (let i = 0; i < 50; i++) await tx`select * from app.authorize_file_access(${u.fileId})`
      for (let i = 0; i < 50; i++) await tx`select * from app.authorize_file_download(${u.fileId})`
    })
    const [a] = await alertFor('bulk_downloads', `user:${md.userId}`)
    expect(a.details.downloads_last_hour).toBeGreaterThanOrEqual(50)
    expect(a.details.total_last_hour).toBeGreaterThanOrEqual(100)
  })

  it('repeated PORTAL downloads through one student portal account raise their own alert', async () => {
    const u = await uploaded('migration_certificate')
    for (const q of (await documents.getDocumentReview(u.docs, u.docId))!.requirements.filter((x) => x.is_mandatory)) await documents.recordVerification(u.docs, u.docId, q.id, 'present')
    await documents.documentAction(u.docs, u.docId, 'verify'); await documents.documentAction(u.docs, u.docId, 'submit')
    await securityClear(u.docId); await documents.documentAction(u.mgr, u.docId, 'approve')
    const pub = await pa.publishDocument(u.mgr, u.docId, 'Approved copy (fictional)')
    const token = `bulk-${rand()}-${Date.now()}`
    await adminSql()`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${token}, ${[u.studentId]}, ${u.studentId})`
    await anonymous(async (tx) => { for (let i = 0; i < 100; i++) await tx`select * from app.portal_download(${token}, ${pub}, null)` })
    const [a] = await alertFor('bulk_portal_downloads', `portal-student:${u.studentId}`)
    expect(a).toMatchObject({ severity: 'high', details: { student_id: u.studentId } })
    expect(a.details.portal_downloads_last_hour).toBeGreaterThanOrEqual(100)
  })

  it('normal low-volume access creates no alert; alerts and the audit log stay immutable', async () => {
    const u = await uploaded('tenth_certificate', 'docs2@demo.test')
    await scanResult(u.key, 'clean')
    const d2 = await ctxFor('docs2@demo.test')
    for (let i = 0; i < 5; i++) await documents.fileContent(d2, u.fileId)
    expect(await alertFor('bulk_downloads', `user:${d2.userId}`)).toHaveLength(0)
    const [any] = await adminSql()`select id from security_alerts limit 1`
    await expectDbError(as('md@demo.test', (tx) => tx`update security_alerts set severity = 'info' where id = ${any.id}`), '42501')
    await expectDbError(adminSql()`update audit_logs set action = 'tampered' where id = (select max(id) from audit_logs)`, 'P0001')
  })
})
