/** Phase 1: secure file storage, with task attachments as the first use. Fictional data; a simulated clamd speaks the real protocol. */
import { createServer, type Server } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { anonymous, db } from '@/lib/db'
import { rescanPendingFiles } from '@/lib/security/jobs'
import { getStorage } from '@/lib/storage'
import { ServiceError } from '@/lib/errors'
import * as secure from '@/services/secure-files'
import * as notifications from '@/services/staff-notifications'
import * as students from '@/services/students'
import * as tasks from '@/services/tasks'
import { adminSql, as, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string; let GRD: string
let clamd: Server; let clamdPort = 0
const MARKER = 'FICTIONAL-INFECTED-MARKER'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
const pdf = (extra = '') => new File([new TextEncoder().encode(`%PDF-1.4\n% ${rand()} ${extra}\n%%EOF`)], 'evidence.pdf', { type: 'application/pdf' })
const MANAGER = 'edx.manager@demo.test'; const COUNSELLOR = 'edx.counsellor@demo.test'; const OTHER = 'edx.counsellor2@demo.test'

async function refuses(p: Promise<unknown>, kindOrText?: string) {
  try { await p } catch (e) {
    expect(e).toBeInstanceOf(ServiceError)
    if (kindOrText) expect(`${(e as ServiceError).kind} ${(e as ServiceError).message}`).toContain(kindOrText)
    return
  }
  throw new Error('expected a refusal')
}
async function taskFor(email = COUNSELLOR, extra: Record<string, unknown> = {}) {
  return tasks.createTask(await ctxFor(MANAGER), { orgId: EDX, title: `Files task ${rand()}`, assignedTo: await userId(email), ...extra })
}
async function attach(taskId: string, by = COUNSELLOR, file = pdf()) {
  const c = await ctxFor(by)
  await secure.uploadSecureFile(c, 'task', taskId, file)
  const rows = await secure.listSecureFiles(c, 'task', taskId)
  return rows[rows.length - 1]
}
const row = async (id: string) => (await adminSql()`select * from secure_files where id = ${id}`)[0]
const audits = (id: string) => adminSql()`select action, outcome, metadata, actor_user_id from audit_logs where entity_type = 'secure_files' and entity_id = ${id} order by id`
const fileCount = async () => (await adminSql()`select count(*)::int as n from secure_files`)[0].n

beforeAll(async () => {
  EDX = await orgId('EDX'); GRD = await orgId('GRD')
  clamd = createServer((sock) => {
    let buf = Buffer.alloc(0)
    sock.on('error', () => {})
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (!buf.subarray(0, 10).toString().startsWith('zINSTREAM\0')) return
      let off = 10; const parts: Buffer[] = []
      while (buf.length >= off + 4) {
        const len = buf.readUInt32BE(off)
        if (len === 0) { sock.end(Buffer.concat(parts).toString('latin1').includes(MARKER) ? 'stream: Fictional.Test.Signature FOUND\0' : 'stream: OK\0'); return }
        if (buf.length < off + 4 + len) return
        parts.push(buf.subarray(off + 4, off + 4 + len)); off += 4 + len
      }
    })
  })
  await new Promise<void>((ok) => clamd.listen(0, '127.0.0.1', () => ok()))
  clamdPort = (clamd.address() as { port: number }).port
})
afterEach(() => { delete process.env.CLAMAV_HOST; delete process.env.CLAMAV_PORT })
afterAll(async () => { clamd.close(); await adminSql().end(); await db().end() })
const scannerOn = () => { process.env.CLAMAV_HOST = '127.0.0.1'; process.env.CLAMAV_PORT = String(clamdPort) }
const scannerDown = () => { process.env.CLAMAV_HOST = '127.0.0.1'; process.env.CLAMAV_PORT = '1' }

describe('upload', () => {
  it('stores bytes privately under a random key, audits it, and tells the other people on the task', async () => {
    const id = await taskFor()
    const f = await attach(id)
    expect(f).toMatchObject({ original_filename: 'evidence.pdf', mime_type: 'application/pdf', scan_status: 'not_scanned', can_remove: true })
    const r = await row(f.id)
    expect(r.storage_key).toMatch(new RegExp(`^org/${EDX}/secure/task/${id}/[0-9a-f-]{36}$`))
    expect((await (await getStorage()).get(r.storage_key)).subarray(0, 5).toString()).toBe('%PDF-')
    expect((await audits(f.id))[0]).toMatchObject({ action: 'secure_file_uploaded', outcome: 'success', actor_user_id: await userId(COUNSELLOR) })
    const mgrRows = (await notifications.listMyNotifications(await ctxFor(MANAGER), { unread: true })).rows
    expect(mgrRows.filter((n) => n.href === `/tasks/${id}`).map((n) => n.event_key)).toContain('task_file_added')
  })

  it('refuses a disguised file, an oversized file and an empty file, and stores nothing', async () => {
    const id = await taskFor(); const c = await ctxFor(COUNSELLOR); const before = await fileCount()
    await refuses(secure.uploadSecureFile(c, 'task', id, new File([new TextEncoder().encode('MZ not a pdf')], 'a.pdf', { type: 'application/pdf' })), 'Only PDF')
    await refuses(secure.uploadSecureFile(c, 'task', id, new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf')), '10 MB')
    await refuses(secure.uploadSecureFile(c, 'task', id, new File([], 'e.pdf')), 'Choose a file')
    expect(await fileCount()).toBe(before)
  })

  it('strips a dangerous file name', async () => {
    const id = await taskFor()
    const f = await attach(id, COUNSELLOR, new File([new TextEncoder().encode(`%PDF-1.4\n${rand()}`)], '../../etc/pass<wd>.pdf', { type: 'application/pdf' }))
    expect(f.original_filename).not.toMatch(/[/<>]/)
  })

  it('refuses people who cannot change the task, in any company; nothing stays in storage', async () => {
    const id = await taskFor(); const before = await fileCount()
    for (const e of [OTHER, 'grd.manager@demo.test', 'admin@demo.test']) await refuses(secure.uploadSecureFile(await ctxFor(e), 'task', id, pdf()), 'forbidden')
    expect(await fileCount()).toBe(before)
  })

  it('the database refuses a key outside the task, and more than 20 files', async () => {
    const id = await taskFor()
    const sha = 'a'.repeat(64)
    await expectDbError(as(COUNSELLOR, (tx) => tx`select app.register_secure_file('task', ${id}, ${`org/${GRD}/secure/task/${id}/x`}, 'a.pdf', 'application/pdf', 10, ${sha})`), '22023')
    await expectDbError(as(COUNSELLOR, (tx) => tx`select app.register_secure_file('task', ${id}, ${'org/' + EDX + '/students/x/y'}, 'a.pdf', 'application/pdf', 10, ${sha})`), '22023')
    const [t] = await adminSql()`select org_id from tasks where id = ${id}`
    for (let i = 0; i < 20; i++) {
      await adminSql()`insert into secure_files (org_id, context_type, context_id, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by)
        values (${t.org_id}, 'task', ${id}, ${`org/${t.org_id}/secure/task/${id}/fill-${i}`}, 'f.pdf', 'application/pdf', 1, ${sha}, ${await userId(COUNSELLOR)})`
    }
    await refuses(secure.uploadSecureFile(await ctxFor(COUNSELLOR), 'task', id, pdf()), '20 files')
  })
})

describe('access', () => {
  it('people on the task can list and open; others, including the other company, get nothing, and the attempt is audited', async () => {
    const id = await taskFor(); const f = await attach(id)
    expect(await secure.openSecureFile(await ctxFor(COUNSELLOR), f.id)).toContain('/api/storage/local')
    expect(await secure.openSecureFile(await ctxFor(MANAGER), f.id)).toBeTruthy()
    for (const e of [OTHER, 'grd.manager@demo.test', 'grd.counsellor@demo.test', 'admin@demo.test']) {
      expect(await secure.listSecureFiles(await ctxFor(e), 'task', id), e).toHaveLength(0)
      expect(await secure.openSecureFile(await ctxFor(e), f.id), e).toBeNull()
    }
    const a = await audits(f.id)
    expect(a.filter((x) => x.action === 'file_download' && x.outcome === 'success')).toHaveLength(2)
    expect((await adminSql()`select count(*)::int as n from audit_logs where action = 'file_download' and entity_type = 'secure_files' and entity_id = ${f.id} and outcome = 'denied'`)[0].n).toBe(4)
    expect(await db()`select id from secure_files`).toHaveLength(0) // no signed-in user
  })

  it('a task linked to a student also needs read access to that student', async () => {
    const mgr = await ctxFor(MANAGER)
    const s = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Files Student Fictional', phone: `+91 90097 ${rand().slice(0, 5)}` })
    if (!s.ok) throw new Error('student not created')
    const id = await tasks.createTask(mgr, { orgId: EDX, title: `Linked ${rand()}`, studentId: s.id })
    const f = await attach(id, MANAGER)
    // an assigned-only role sees the task, but neither its attachment nor a way to add one
    const docs = await ctxFor('docs@demo.test')
    await adminSql()`update tasks set assigned_to = ${docs.userId} where id = ${id}`
    expect((await as('docs@demo.test', (tx) => tx`select app.can_read_student(${s.id}) as ok`))[0].ok).toBe(false)
    expect(await as('docs@demo.test', (tx) => tx`select id from tasks where id = ${id}`)).toHaveLength(1)
    expect(await secure.listSecureFiles(docs, 'task', id)).toHaveLength(0)
    expect(await secure.openSecureFile(docs, f.id)).toBeNull()
    expect(await secure.canAttachSecureFile(docs, 'task', id)).toBe(false)
    await refuses(secure.uploadSecureFile(docs, 'task', id, pdf()), 'forbidden')
    // once assigned to the student, the same person can read it
    await students.setAssignment(mgr, s.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
    expect((await secure.listSecureFiles(docs, 'task', id)).map((x) => x.id)).toEqual([f.id])
    expect(await secure.openSecureFile(docs, f.id)).toBeTruthy()
  })

  it('the application role cannot read storage keys or write the table', async () => {
    const id = await taskFor(); const f = await attach(id)
    await expectDbError(as(COUNSELLOR, (tx) => tx`select storage_key from secure_files`), '42501')
    await expectDbError(as(COUNSELLOR, (tx) => tx`select scan_detail from secure_files`), '42501')
    await expectDbError(as(COUNSELLOR, (tx) => tx`update secure_files set scan_status = 'clean' where id = ${f.id}`), '42501')
    await expectDbError(as(COUNSELLOR, (tx) => tx`delete from secure_files where id = ${f.id}`), '42501')
    await expectDbError(as(COUNSELLOR, (tx) => tx`insert into secure_files (org_id) values (${EDX})`), '42501')
    await expectDbError(as(MANAGER, (tx) => tx`select app.record_secure_file_scan('x', 'clean', 'e', null)`), '42501')
    await expectDbError(as(MANAGER, (tx) => tx`select * from app.secure_files_to_rescan(5)`), '42501')
  })

  it('removal: the uploader or a manager of all tasks; others are refused; a removed file is gone from use but kept in storage, and audited', async () => {
    const id = await taskFor(); const a = await attach(id); const b = await attach(id)
    await refuses(secure.removeSecureFile(await ctxFor(OTHER), a.id))
    await refuses(secure.removeSecureFile(await ctxFor('grd.manager@demo.test'), a.id))
    await secure.removeSecureFile(await ctxFor(COUNSELLOR), a.id)
    expect((await secure.listSecureFiles(await ctxFor(COUNSELLOR), 'task', id)).map((f) => f.id)).toEqual([b.id])
    expect(await secure.openSecureFile(await ctxFor(COUNSELLOR), a.id)).toBeNull()
    expect(await (await getStorage()).get((await row(a.id)).storage_key)).toBeTruthy()
    expect((await audits(a.id)).map((x) => x.action)).toContain('secure_file_removed')
    const [{ ok: managerCan }] = await as(MANAGER, (tx) => tx`select app.has_perm(${EDX}, 'tasks.update.all') as ok`)
    expect(managerCan).toBe(true)
    await secure.removeSecureFile(await ctxFor(MANAGER), b.id)
    await refuses(secure.removeSecureFile(await ctxFor(COUNSELLOR), a.id)) // already removed
  })
})

describe('scan states', () => {
  it('no scanner: not scanned, labelled, and never claimed as clean', async () => {
    const f = await attach(await taskFor())
    expect((await row(f.id)).scan_status).toBe('not_scanned')
    expect((await rescanPendingFiles(10)).scanner).toBeNull()
    expect((await row(f.id)).scan_status).toBe('not_scanned')
  })

  it('clean with a scanner; scanner unreachable is scan failed', async () => {
    scannerOn()
    const clean = await attach(await taskFor())
    expect((await row(clean.id))).toMatchObject({ scan_status: 'clean', scan_engine: 'ClamAV' })
    scannerDown()
    const failed = await attach(await taskFor())
    expect((await row(failed.id)).scan_status).toBe('scan_failed')
    // the scanner is configured, so a file it has not passed is held until scanned or cleared
    expect(await secure.openSecureFile(await ctxFor(COUNSELLOR), failed.id)).toBeNull()
  })

  it('an infected upload is refused and never stored; it is audited and raises a critical alert', async () => {
    scannerOn()
    const id = await taskFor(); const before = await fileCount()
    await refuses(secure.uploadSecureFile(await ctxFor(COUNSELLOR), 'task', id, pdf(MARKER)), 'threat')
    expect(await fileCount()).toBe(before)
    expect((await adminSql()`select severity from security_alerts where kind = 'malware_detected' and subject_key = ${`file:task:${id}`}`)[0]).toMatchObject({ severity: 'critical' })
  })

  it('the daily re-scan finds a stored threat: quarantined for good, never served, alerted, and the uploader told once', async () => {
    const id = await taskFor()
    const f = await attach(id, COUNSELLOR, pdf(MARKER)) // stored while no scanner was available
    const good = await attach(id)
    await adminSql()`update secure_files set scanned_at = now() + interval '1 day' where scan_status = 'not_scanned' and id not in (${f.id}, ${good.id})`
    scannerOn()
    const r = await rescanPendingFiles(10)
    expect(r.infected).toBe(1)
    expect((await row(f.id)).scan_status).toBe('infected')
    expect((await row(good.id)).scan_status).toBe('clean')
    expect(await secure.openSecureFile(await ctxFor(COUNSELLOR), f.id)).toBeNull()
    expect(await secure.openSecureFile(await ctxFor('md@demo.test'), f.id)).toBeNull()
    expect((await audits(f.id)).filter((a) => a.action === 'malware_detected')).toHaveLength(1)
    const reason = (await audits(f.id)).filter((a) => a.action === 'file_download').map((a) => a.metadata.reason)
    expect(reason).toContain('quarantined')
    expect((await adminSql()`select severity from security_alerts where kind = 'malware_detected' and subject_key = ${`file:${f.id}`}`)[0]).toMatchObject({ severity: 'critical' })
    const told = (await notifications.listMyNotifications(await ctxFor(COUNSELLOR), { unread: true })).rows.filter((n) => n.event_key === 'file_quarantined' && n.href === `/tasks/${id}`)
    expect(told).toHaveLength(1)
    expect(told[0].severity).toBe('critical')
    // final: a later result can't release it
    const infectedKey = (await row(f.id)).storage_key
    await anonymous((tx) => tx`select app.record_secure_file_scan(${infectedKey}, 'clean', 'ClamAV', null)`)
    expect((await row(f.id)).scan_status).toBe('infected')
    expect((await adminSql()`select id from staff_notifications where dedupe_key = ${'file_quarantined:' + f.id}`)).toHaveLength(1)
  })

  it('a failed re-scan never downgrades a clean file; a failed file can become clean; removed files are not scanned', async () => {
    const f = await attach(await taskFor()); const key = (await row(f.id)).storage_key
    await anonymous((tx) => tx`select app.record_secure_file_scan(${key}, 'scan_failed', 'ClamAV', 'timeout')`)
    expect((await row(f.id)).scan_status).toBe('scan_failed')
    await anonymous((tx) => tx`select app.record_secure_file_scan(${key}, 'clean', 'ClamAV', null)`)
    await anonymous((tx) => tx`select app.record_secure_file_scan(${key}, 'scan_failed', 'ClamAV', 'timeout')`)
    expect((await row(f.id)).scan_status).toBe('clean')
    const gone = await attach(await taskFor())
    await secure.removeSecureFile(await ctxFor(COUNSELLOR), gone.id)
    const queue = await anonymous((tx) => tx<{ storage_key: string }[]>`select * from app.secure_files_to_rescan(500)`)
    const goneKey = (await row(gone.id)).storage_key
    expect(queue.map((q) => q.storage_key)).not.toContain(goneKey)
  })

  it('the existing quarantine notice also tells the uploader of a student document file', async () => {
    const [d] = await adminSql()`select f.id, f.storage_key, f.uploaded_by, f.scan_status from document_files f where f.scan_status <> 'infected' order by f.uploaded_at desc limit 1`
    await anonymous((tx) => tx`select app.record_file_scan(${d.storage_key}, 'infected', 'ClamAV', 'Fictional.Test.Signature')`)
    const [n] = await adminSql()`select event_key, severity, email_status from staff_notifications where dedupe_key = ${'file_quarantined:' + d.id}`
    expect(n).toMatchObject({ event_key: 'file_quarantined', severity: 'critical', email_status: 'pending' })
  })
})
