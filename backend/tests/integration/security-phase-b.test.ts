/** Phase B – virus-scan status, quarantine, manual clearance, approval/courier gates, security alerts, login history, 2FA reset. Fictional data. */
import { createServer, type Server } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { anonymous, db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import { adminResetMfa } from '@/lib/auth/mfa-service'
import { hashToken, newTokenValue } from '@/lib/auth/tokens'
import { clamav } from '@/lib/security/scanner'
import { rescanPendingFiles } from '@/lib/security/jobs'
import * as courier from '@/services/courier'
import * as documents from '@/services/documents'
import * as security from '@/services/security'
import * as students from '@/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const MARKER = 'FICTIONAL-MALWARE-TEST-MARKER'
const pdf = (text = 'fictional scan') => new File([new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF`)], 'scan.pdf', { type: 'application/pdf' })

/** A minimal clamd speaking the real INSTREAM protocol: "FOUND" when the marker is in the stream. */
let clamd: Server
let clamdPort = 0
beforeAll(async () => {
  EDX = await orgId('EDX')
  clamd = createServer((sock) => {
    let buf = Buffer.alloc(0)
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (!buf.subarray(0, 10).toString().startsWith('zINSTREAM\0')) return
      let off = 10; const parts: Buffer[] = []
      while (buf.length >= off + 4) {
        const len = buf.readUInt32BE(off)
        if (len === 0) {
          const body = Buffer.concat(parts).toString('latin1')
          sock.end(body.includes(MARKER) ? 'stream: Fictional.Test.Signature FOUND\0' : 'stream: OK\0')
          return
        }
        if (buf.length < off + 4 + len) return
        parts.push(buf.subarray(off + 4, off + 4 + len)); off += 4 + len
      }
    })
  })
  await new Promise<void>((ok) => clamd.listen(0, '127.0.0.1', () => ok()))
  clamdPort = (clamd.address() as { port: number }).port
})
afterAll(async () => { clamd.close(); await adminSql().end(); await db().end() })
afterEach(() => { delete process.env.CLAMAV_HOST; delete process.env.CLAMAV_PORT })
const scannerOn = (port = clamdPort) => { process.env.CLAMAV_HOST = '127.0.0.1'; process.env.CLAMAV_PORT = String(port) }

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}

/** A student with a Plus Two item uploaded by documentation staff, verified and submitted (ready for approval). */
async function submittedDoc(file = pdf()) {
  const mgr = await ctxFor('edx.manager@demo.test'); const docs = await ctxFor('docs@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Scan Student', phone: `+91 90095 ${rand()}` })
  if (!r.ok) throw new Error()
  await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
  const item = (await documents.getChecklist(mgr, r.id)).items.find((i) => i.type_key === 'plus_two_certificate')!
  let uploadError: unknown = null
  await documents.uploadDocument(docs, item.id, file).catch((e) => { uploadError = e })
  const [f] = await adminSql()`select f.id, f.scan_status, f.scan_engine, f.scan_detail from student_documents d join document_files f on f.id = d.current_file_id where d.id = ${item.id}`
  return { mgr, docs, studentId: r.id, docId: item.id, file: f, uploadError }
}
async function verifyAndSubmit(s: Awaited<ReturnType<typeof submittedDoc>>) {
  for (const q of (await documents.getDocumentReview(s.docs, s.docId))!.requirements.filter((x) => x.is_mandatory)) await documents.recordVerification(s.docs, s.docId, q.id, 'present')
  await documents.documentAction(s.docs, s.docId, 'verify'); await documents.documentAction(s.docs, s.docId, 'submit')
}
const fileStatus = async (id: string) => (await adminSql()`select scan_status from document_files where id = ${id}`)[0].scan_status as string
const alerts = (kind: string) => adminSql()`select * from security_alerts where kind = ${kind} order by last_seen_at desc`

describe('virus scanning, quarantine and manual clearance', () => {
  it('without a scanner a file stays "not scanned", cannot be approved, and needs a MANUAL clearance (audited, alerted, never shown as scanned)', async () => {
    const s = await submittedDoc()
    expect(s.file.scan_status).toBe('not_scanned')
    await verifyAndSubmit(s)
    const e = await expectServiceError(documents.documentAction(s.mgr, s.docId, 'approve'))
    expect(e.message).toMatch(/virus scan or manual security clearance/)
    // who may clear: not a counsellor or manager; not the uploader; a reason is required
    await expectServiceError(security.clearFileManually(await ctxFor('edx.counsellor@demo.test'), s.file.id, 'Checked the original in person'), 'forbidden')
    await expectServiceError(security.clearFileManually(s.mgr, s.file.id, 'Checked the original in person'), 'forbidden')
    await expectServiceError(security.clearFileManually(await ctxFor('md@demo.test'), s.file.id, 'short'), 'invalid')
    await adminSql()`insert into role_permissions (role_id, permission_key) select id, 'documents.security_clear' from roles where org_id = ${EDX} and key = 'documentation'
      on conflict do nothing`
    try {
      await expectServiceError(security.clearFileManually(await ctxFor('docs@demo.test'), s.file.id, 'I uploaded it myself, trust me'), 'forbidden') // uploader
    } finally {
      await adminSql()`delete from role_permissions where permission_key = 'documents.security_clear' and role_id in (select id from roles where org_id = ${EDX} and key = 'documentation')`
    }
    const md = await ctxFor('md@demo.test')
    await security.clearFileManually(md, s.file.id, 'Original certificate seen in person (fictional)')
    const [f] = await adminSql()`select scan_status, scan_engine, scanned_at, cleared_by, clearance_reason from document_files where id = ${s.file.id}`
    expect(f).toMatchObject({ scan_status: 'manually_cleared', scan_engine: null, scanned_at: null, cleared_by: md.userId })
    const [a] = await adminSql()`select after_data from audit_logs where action = 'file_manual_security_clearance' and entity_id = ${s.file.id}`
    expect(a.after_data.note).toMatch(/MANUAL clearance – not an automated virus scan/)
    expect((await alerts('manual_clearance')).length).toBeGreaterThan(0)
    await documents.documentAction(s.mgr, s.docId, 'approve')
    expect((await adminSql()`select status from student_documents where id = ${s.docId}`)[0].status).toBe('approved')
    // it cannot be cleared twice, and the review page reports it as manual
    await expectServiceError(security.clearFileManually(md, s.file.id, 'Again for no reason at all'))
    expect((await documents.getDocumentReview(md, s.docId))!.files[0].scan_status).toBe('manually_cleared')
  })

  it('with ClamAV: clean files are marked clean; infected uploads are quarantined – no download, approval, clearance or courier – and raise a critical alert', async () => {
    scannerOn()
    const ok = await submittedDoc()
    expect(ok.file).toMatchObject({ scan_status: 'clean', scan_engine: 'ClamAV' })
    await verifyAndSubmit(ok)
    await documents.documentAction(ok.mgr, ok.docId, 'approve') // no manual step needed

    const bad = await submittedDoc(pdf(`scan with ${MARKER}`))
    expect((bad.uploadError as Error)?.message).toMatch(/quarantined/)
    expect(bad.file).toMatchObject({ scan_status: 'infected', scan_detail: 'Fictional.Test.Signature' })
    const md = await ctxFor('md@demo.test')
    expect(await as('md@demo.test', (tx) => tx`select * from app.authorize_file_download(${bad.file.id})`)).toHaveLength(0)
    expect((await adminSql()`select metadata from audit_logs where action = 'file_download' and entity_id = ${bad.file.id} and outcome = 'denied'`)[0].metadata).toMatchObject({ reason: 'quarantined' })
    await expectServiceError(security.clearFileManually(md, bad.file.id, 'Trying to release malware'))
    await expect(verifyAndSubmit(bad).then(() => documents.documentAction(bad.mgr, bad.docId, 'approve'))).rejects.toThrow()
    // an infected file stays infected even if a later scan says otherwise
    const [{ key }] = await adminSql()`select storage_key as key from document_files where id = ${bad.file.id}`
    await anonymous((tx) => tx`select app.record_file_scan(${key}, 'clean', 'ClamAV', null)`)
    expect(await fileStatus(bad.file.id)).toBe('infected')
    const [crit] = await alerts('malware_detected')
    expect(crit).toMatchObject({ severity: 'critical' })
    // courier exception path cannot release an uncleared or infected upload
    const addr = (await adminSql()`select id from courier_addresses where org_id = ${EDX} and is_active limit 1`)[0]?.id
      ?? (await adminSql()`insert into courier_addresses (org_id, label, recipient, address) values (${EDX}, 'Test office', 'Test recipient', 'Fictional street 1') returning id`)[0].id
    await expect(courier.issueInstructions(md, bad.studentId, addr, [bad.docId], 'Urgent original (test)')).rejects.toThrow(/virus scan or manual security clearance/)
  })

  it('a failed scan (scanner unreachable) is recorded as such and still blocks approval; the daily job re-scans pending files', async () => {
    scannerOn(1) // nothing listens on port 1
    const s = await submittedDoc()
    expect(s.file.scan_status).toBe('scan_failed')
    await verifyAndSubmit(s)
    await expectServiceError(documents.documentAction(s.mgr, s.docId, 'approve'))
    scannerOn()
    const r = await rescanPendingFiles(500)
    expect(r.scanner).toBe('ClamAV')
    expect(r.scanned).toBeGreaterThan(0)
    expect(await fileStatus(s.file.id)).toBe('clean')
    await documents.documentAction(s.mgr, s.docId, 'approve')
    // the re-scan queue and scan recording are system-only / server-only
    await expectDbError(as('md@demo.test', (tx) => tx`select * from app.files_to_rescan(10)`), '42501')
  })

  it('the ClamAV client handles clean, infected and broken replies', async () => {
    expect((await clamav(Buffer.from('hello'), '127.0.0.1', clamdPort)).status).toBe('clean')
    expect(await clamav(Buffer.from(MARKER), '127.0.0.1', clamdPort)).toMatchObject({ status: 'infected', detail: 'Fictional.Test.Signature' })
    expect((await clamav(Buffer.from('x'), '127.0.0.1', 1)).status).toBe('scan_failed')
  })
})

describe('security alerts', () => {
  it('repeated failed sign-ins raise one grouped alert; only security.alerts holders see and acknowledge alerts; nobody can edit them', async () => {
    const email = `attacker.target.${rand()}@example.test`
    for (let i = 0; i < 6; i++) await anonymous((tx) => tx`select app.auth_record_attempt(${email}, '203.0.113.7', false, null)`)
    const [a] = await adminSql()`select * from security_alerts where kind = 'repeated_failed_logins' and subject_key = ${'email:' + email}`
    expect(a).toBeDefined()
    expect(a.occurrences).toBe(2) // 5th and 6th failures grouped
    const md = await ctxFor('md@demo.test')
    expect((await security.listAlerts(md, { open: true })).some((x) => x.id === a.id)).toBe(true)
    for (const e of ['edx.manager@demo.test', 'admin@demo.test', 'ceo@demo.test']) {
      await expectServiceError(security.listAlerts(await ctxFor(e)), 'forbidden')
      expect(await as(e, (tx) => tx`select id from security_alerts`)).toHaveLength(0) // database-level
      await expectServiceError(security.acknowledgeAlert(await ctxFor(e), a.id), 'forbidden')
    }
    await expectDbError(as('md@demo.test', (tx) => tx`update security_alerts set severity = 'info' where id = ${a.id}`), '42501')
    await expectDbError(as('md@demo.test', (tx) => tx`delete from security_alerts where id = ${a.id}`), '42501')
    await security.acknowledgeAlert(md, a.id, 'Fictional: user confirmed they forgot the password')
    expect((await adminSql()`select acknowledged_by from security_alerts where id = ${a.id}`)[0].acknowledged_by).toBe(md.userId)
  })

  it('permission changes, role assignments, large and frequent exports and bulk downloads raise alerts', async () => {
    const [role] = await adminSql()`insert into roles (org_id, key, name) values (${EDX}, ${'alert_role_' + [...rand()].map((d) => 'abcdefghij'[Number(d)]).join('')}, 'Alert test role') returning id`
    await as('md@demo.test', (tx) => tx`insert into role_permissions (role_id, permission_key) values (${role.id}, 'reports.export.pii')`)
    const [p] = await adminSql()`select severity, details from security_alerts where kind = 'permission_change' and subject_key = ${'role:' + role.id}`
    expect(p).toMatchObject({ severity: 'high', details: { permission: 'reports.export.pii', change: 'grant' } })
    // a large export by a manager
    await as('edx.manager@demo.test', (tx) => tx`select app.audit('export', 'report', 'students', ${EDX}, null, null, null, 'success', '{"rows": 750, "pii": true}'::jsonb)`)
    const mgr = (await ctxFor('edx.manager@demo.test')).userId
    expect((await adminSql()`select severity from security_alerts where kind = 'large_export' and subject_key = ${'user:' + mgr}`)[0].severity).toBe('high')
    for (let i = 0; i < 10; i++) await as('edx.manager@demo.test', (tx) => tx`select app.audit('export', 'report', 'tasks', ${EDX}, null, null, null, 'success', '{"rows": 3}'::jsonb)`)
    expect((await adminSql()`select 1 from security_alerts where kind = 'frequent_exports' and subject_key = ${'user:' + mgr}`)).toHaveLength(1)
    // a refused export
    await as('edx.counsellor@demo.test', (tx) => tx`select app.audit('export', 'report', 'payments', ${EDX}, null, null, null, 'denied', '{}'::jsonb)`)
    expect((await adminSql()`select 1 from security_alerts where kind = 'export_denied'`).length).toBeGreaterThan(0)
    // bulk downloads (100 in an hour)
    await as('docs@demo.test', async (tx) => { for (let i = 0; i < 100; i++) await tx`select app.audit('file_download', 'document_files', ${'x' + i}, ${EDX})` })
    const docsId = (await ctxFor('docs@demo.test')).userId
    expect((await adminSql()`select severity from security_alerts where kind = 'bulk_downloads' and subject_key = ${'user:' + docsId}`)[0].severity).toBe('high')
  })
})

describe('login history and two-factor reset', () => {
  it('login history and active sessions: own and for authorised administrators only', async () => {
    const md = await ctxFor('md@demo.test'); const c = await ctxFor('edx.counsellor@demo.test')
    await anonymous((tx) => tx`select app.auth_record_attempt('edx.counsellor@demo.test', '198.51.100.9', false, null)`)
    await anonymous((tx) => tx`select app.auth_record_attempt('edx.counsellor@demo.test', '198.51.100.9', true, ${c.userId})`)
    const token = newTokenValue()
    await adminSql()`select app.auth_create_session(${c.userId}, ${hashToken(token)}, 12, '198.51.100.9', 'vitest-browser', false)`
    const own = (await security.loginActivity(c, c.userId))!
    expect(own.history.slice(0, 2).map((h) => h.event)).toEqual(['login', 'login_failed'])
    expect(own.sessions.some((s) => s.user_agent === 'vitest-browser')).toBe(true)
    expect(await security.loginActivity(md, c.userId)).not.toBeNull()
    expect(await security.loginActivity(c, md.userId)).toBeNull()
    expect(await security.loginActivity(await ctxFor('edx.manager@demo.test'), md.userId)).toBeNull()
    expect(JSON.stringify(own)).not.toMatch(/token|hash/i)
  })

  it('2FA reset needs users.mfa_reset (MD) and a verification note; a System Administrator cannot bypass; the reset is alerted', async () => {
    const md = await ctxFor('md@demo.test')
    const target = (await ctxFor('edx.counsellor@demo.test')).userId
    await expectServiceError(adminResetMfa(await ctxFor('admin@demo.test'), target, 'Identity verified by phone (fictional)'), 'forbidden')
    await expectServiceError(adminResetMfa(md, target, 'ok'), 'invalid')
    await adminResetMfa(md, target, 'Identity verified by video call (fictional)')
    const [a] = await adminSql()`select severity, details from security_alerts where kind = 'mfa_reset' and subject_key = ${'user:' + target}`
    expect(a).toMatchObject({ severity: 'high', details: { reason: 'Identity verified by video call (fictional)' } })
  })
})
