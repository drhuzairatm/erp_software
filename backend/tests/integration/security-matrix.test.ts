/**
 * Phase C – security and isolation matrix (fictional data):
 *  1. company isolation across EVERY table that holds student data (generic sweep) + every service read/write path
 *  2. student-level isolation (assigned-only staff, portal sessions of different students)
 *  3. role permissions (who may approve, pay, verify, export, manage)
 *  4. session security (revoked / expired / idle / waiting for 2-step code), TOTP replay, single-use recovery codes
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous, db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import { currentStep, hashRecoveryCode, newTotpSecret, totp, verifyTotp } from '@/lib/auth/mfa'
import { hashToken, newTokenValue } from '@/lib/auth/tokens'
import * as ac from '@/services/academic'
import * as admin from '@/services/admin'
import * as att from '@/services/attestation'
import * as documents from '@/services/documents'
import * as pp from '@/services/passport'
import * as payments from '@/services/payments'
import * as rq from '@/services/requirements'
import * as security from '@/services/security'
import * as students from '@/services/students'
import * as tasks from '@/services/tasks'
import { adminSql, as, ctxFor, orgId, securityClear } from '../support/helpers'

let EDX: string, GRD: string, GRD_FEE: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const pdf = () => new File([new TextEncoder().encode('%PDF-1.4\n% fictional\n%%EOF')], 'scan.pdf', { type: 'application/pdf' })
afterAll(async () => { await adminSql().end(); await db().end() })

async function refused(p: Promise<unknown>) {
  try { const r = await p; return r === null || r === undefined || (Array.isArray(r) && r.length === 0) } catch (e) { return e instanceof ServiceError || (e as { code?: string }).code === '42501' }
}
/** A write must be refused for authorization/isolation reasons (not because the input was malformed). */
async function deniedWrite(p: Promise<unknown>) {
  try { await p; return 'succeeded' } catch (e) {
    const se = e as ServiceError
    if (se.fieldErrors && Object.keys(se.fieldErrors).length) return `validation: ${JSON.stringify(se.fieldErrors)}`
    return 'denied'
  }
}

/** A GRADUATER-only student with data in many modules (document approved, payment, task, passport, academic record). */
let G: { id: string; docId: string; fileId: string; taskId: string; entryId: string }
beforeAll(async () => {
  EDX = await orgId('EDX'); GRD = await orgId('GRD')
  const gm = await ctxFor('grd.manager@demo.test')
  const r = await students.createStudent(gm, { originatingOrgId: GRD, fullName: 'Graduater Only Student', phone: `+91 90061 ${rand()}`, phone2: `+91 90062 ${rand()}`,
    email: `grd.only.${rand()}@example.test`, passportNumber: `GO${rand()}`, passportExpiry: '2034-01-01' })
  if (!r.ok) throw new Error()
  const docId = (await documents.getChecklist(gm, r.id)).items.find((i) => i.type_key === 'plus_two_certificate')!.id
  await documents.uploadDocument(gm, docId, pdf())
  const [{ id: fileId }] = await adminSql()`select current_file_id as id from student_documents where id = ${docId}`
  await ac.saveRecord(gm, r.id, null, { kind: 'plus_two', gradingSystem: 'marks', totalMarks: '100' }, [{ key: 'biology', name: 'Biology', max: '100', obtained: '80' }])
  const t = await tasks.createTask(gm, { orgId: GRD, studentId: r.id, title: 'Graduater-only task', assignedTo: gm.userId })
  const [fee] = await adminSql()`select id from fee_categories where org_id = ${GRD} and kind = 'service' limit 1`
  GRD_FEE = fee.id
  const entryId = await payments.recordEntry(await ctxFor('grd.finance@demo.test').catch(() => gm), r.id, { orgId: GRD, feeCategoryId: fee.id, entryDate: '2026-10-01', entryType: 'charge', amount: '1000', currency: 'INR' }).catch(() => '')
  const [task] = await adminSql()`select id from tasks where student_id = ${r.id} limit 1`
  G = { id: r.id, docId, fileId, taskId: task?.id ?? String(t), entryId: String(entryId) }
})

describe('1. company isolation (Edulinks staff vs a GRADUATER-only student)', () => {
  // Edulinks-ONLY accounts (the CEO, System Administrator and MD are members of both companies by design – tested separately)
  const EDX_USERS = ['edx.counsellor@demo.test', 'edx.counsellor2@demo.test', 'edx.manager@demo.test', 'docs@demo.test', 'edx.finance@demo.test', 'edx.finance2@demo.test']

  it('generic sweep: every table with a student_id column returns no rows of the other company\'s student, for every Edulinks role', async () => {
    const tables = (await adminSql()`select c.table_name as t from information_schema.columns c join information_schema.tables x on x.table_name = c.table_name and x.table_schema = c.table_schema
      where c.table_schema = 'public' and c.column_name = 'student_id' and x.table_type = 'BASE TABLE' order by 1`).map((r) => r.t as string)
    expect(tables.length).toBeGreaterThan(15)
    const leaks: string[] = []
    for (const email of EDX_USERS) {
      for (const t of tables) {
        try {
          const [r] = await as(email, (tx) => tx.unsafe(`select count(*)::int as n from public."${t}" where student_id = $1`, [G.id]))
          if (r.n > 0) leaks.push(`${email} → ${t}: ${r.n}`)
        } catch (e) { if ((e as { code?: string }).code !== '42501') throw e } // not granted at all = no access
      }
      const [s] = await as(email, (tx) => tx`select count(*)::int as n from v_students where id = ${G.id}`)
      if (s.n) leaks.push(`${email} → v_students`)
    }
    expect(leaks).toEqual([])
  })

  it('every service read of the other company\'s records returns nothing, and every write is refused', async () => {
    for (const email of EDX_USERS) {
      const c = await ctxFor(email)
      const reads: [string, () => Promise<unknown>][] = [
        ['student', () => students.getStudent(c, G.id)],
        ['checklist', () => documents.getChecklist(c, G.id).then((r) => r.items)],
        ['document review', () => documents.getDocumentReview(c, G.docId)],
        ['file download', () => as(email, (tx) => tx`select * from app.authorize_file_download(${G.fileId})`)],
        ['academic', () => ac.getAcademic(c, G.id)],
        ['passport', () => pp.getPassportData(c, G.id)],
        ['advisories', () => rq.studentAdvisories(c, G.id)],
        ['attestation', () => att.getDocumentAttestation(c, G.docId)],
        ['task', () => tasks.getTask(c, G.taskId)],
        ['ledger', () => payments.studentLedger(c, G.id).then((l) => (l.entries.length || l.balances.length || l.inr.length ? l : null))],
        ['timeline', () => students.getTimeline(c, G.id)],
      ]
      for (const [what, p] of reads) expect(await refused(p()), `${email} read ${what}`).toBe(true)
      const writes: [string, () => Promise<unknown>][] = [
        ['update student', () => students.updateStudent(c, G.id, { originatingOrgId: GRD, fullName: 'Hacked Name', phone: '+91 90000 00000' })],
        ['change stage', () => students.changeStage(c, G.id, { toStage: 'registration' })],
        ['upload', () => documents.uploadDocument(c, G.docId, pdf())],
        ['document action', () => documents.documentAction(c, G.docId, 'reject', 'x')],
        ['academic record', () => ac.saveRecord(c, G.id, null, { kind: 'other', title: 'Injected' }, [])],
        ['passport', () => pp.recordPassport(c, G.id, { kind: 'correction', passportNumber: 'XZ1234567', holderName: 'HACKED NAME', expiryDate: '2040-01-01', notes: 'cross-company attempt' })],
        ['payment', () => payments.recordEntry(c, G.id, { orgId: GRD, feeCategoryId: GRD_FEE, entryDate: '2026-10-01', entryType: 'charge', amount: '1', currency: 'INR' })],
        ['task', () => tasks.createTask(c, { orgId: EDX, studentId: G.id, title: 'Cross-company task' })],
        ['note', () => students.addNote(c, G.id, { orgId: GRD, body: 'Cross-company note', visibility: 'internal' })],
        ['manual clearance', () => security.clearFileManually(c, G.fileId, 'Cross-company clearance attempt')],
      ]
      for (const [what, p] of writes) expect(await deniedWrite(p()), `${email} write ${what}`).toBe('denied')
    }
    const [s] = await adminSql()`select full_name from students where id = ${G.id}`
    expect(s.full_name).toBe('Graduater Only Student')
    expect((await adminSql()`select count(*)::int as n from student_notes where student_id = ${G.id}`)[0].n).toBe(0)
  })

  it('dual-company roles: the CEO sees the GRADUATER student but no amounts; the System Administrator gets no student records', async () => {
    expect(await students.getStudent(await ctxFor('ceo@demo.test'), G.id)).not.toBeNull()
    expect(await as('ceo@demo.test', (tx) => tx`select amount from payment_entries where student_id = ${G.id}`)).toHaveLength(0)
    expect(await as('ceo@demo.test', (tx) => tx`select * from student_balances where student_id = ${G.id}`)).toHaveLength(0)
    expect(await students.getStudent(await ctxFor('admin@demo.test'), G.id)).toBeNull()
  })

  it('the MD sees both companies; GRADUATER staff see their own student', async () => {
    expect(await students.getStudent(await ctxFor('md@demo.test'), G.id)).not.toBeNull()
    expect(await students.getStudent(await ctxFor('grd.manager@demo.test'), G.id)).not.toBeNull()
  })
})

describe('2. student-level isolation', () => {
  it('documentation staff only reach students assigned to them (reads and writes)', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Unassigned Student', phone: `+91 90063 ${rand()}` })
    if (!r.ok) throw new Error()
    const docs = await ctxFor('docs@demo.test')
    const docId = (await documents.getChecklist(mgr, r.id)).items[0].id
    expect(await refused(students.getStudent(docs, r.id))).toBe(true)
    expect(await refused(documents.uploadDocument(docs, docId, pdf()))).toBe(true)
    await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
    expect(await students.getStudent(docs, r.id)).not.toBeNull()
  })

  it('a student portal session only ever reaches that student (overview, uploads, downloads)', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const mk = async (n: string) => {
      const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: n, phone: `+91 90064 ${rand()}` })
      if (!r.ok) throw new Error(); return r.id
    }
    const a = await mk('Portal Student Alpha'); const b = await mk('Portal Student Beta')
    const ta = `portal-a-${rand()}-${Date.now()}`
    await adminSql()`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${ta}, ${[a]}, ${a})`
    const bDoc = (await documents.getChecklist(mgr, b)).items[0].id
    expect(await anonymous((tx) => tx`select * from app.portal_upload_target(${ta}, ${bDoc})`)).toHaveLength(0)
    const [ov] = await anonymous((tx) => tx<{ o: unknown }[]>`select app.portal_overview(${ta}) as o`)
    expect(JSON.stringify(ov.o)).toContain('Portal Student Alpha')
    expect(JSON.stringify(ov.o)).not.toContain('Portal Student Beta')
    // a publication of student B cannot be downloaded with A's session
    const [pub] = await adminSql()`select id from portal_publications where student_id <> ${a} limit 1`
    if (pub) expect(await anonymous((tx) => tx`select * from app.portal_download(${ta}, ${pub.id}, '127.0.0.1')`)).toHaveLength(0)
    // an unknown/forged portal token reaches nothing
    expect(await anonymous((tx) => tx<{ o: unknown }[]>`select app.portal_overview('forged-token') as o`).then((r) => r[0].o)).toBeNull()
  })
})

describe('3. role permissions', () => {
  it('only the right roles approve documents, record and verify payments, administer staff, see alerts', async () => {
    const mgr = await ctxFor('edx.manager@demo.test'); const docs = await ctxFor('docs@demo.test')
    const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Role Matrix Student', phone: `+91 90065 ${rand()}` })
    if (!r.ok) throw new Error()
    await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
    const d = (await documents.getChecklist(mgr, r.id)).items.find((i) => i.type_key === 'tenth_certificate')!
    await documents.uploadDocument(docs, d.id, pdf())
    await documents.documentAction(docs, d.id, 'verify'); await documents.documentAction(docs, d.id, 'submit'); await securityClear(d.id)
    for (const e of ['edx.counsellor@demo.test', 'docs@demo.test', 'edx.finance@demo.test', 'ceo@demo.test']) {
      expect(await refused(documents.documentAction(await ctxFor(e), d.id, 'approve')), `${e} approve`).toBe(true)
    }
    const [fee] = await adminSql()`select id from fee_categories where org_id = ${EDX} and kind = 'service' limit 1`
    const entry = { orgId: EDX, feeCategoryId: fee.id, entryDate: '2026-10-01', entryType: 'receipt', amount: '100', currency: 'INR', method: 'cash' }
    for (const e of ['edx.counsellor@demo.test', 'docs@demo.test', 'ceo@demo.test']) expect(await refused(payments.recordEntry(await ctxFor(e), r.id, entry)), `${e} pay`).toBe(true)
    // CEO: never sees amounts – a real charge exists, yet the CEO's ledger view has no entries, balances or totals
    await payments.recordEntry(await ctxFor('edx.finance@demo.test'), r.id, { orgId: EDX, feeCategoryId: fee.id, entryDate: '2026-10-01', entryType: 'charge', amount: '75000', currency: 'INR' })
    expect((await payments.studentLedger(await ctxFor('edx.finance@demo.test'), r.id)).entries.length).toBe(1)
    const ceoView = await payments.studentLedger(await ctxFor('ceo@demo.test'), r.id)
    expect({ e: ceoView.entries.length, b: ceoView.balances.length, i: ceoView.inr.length }).toEqual({ e: 0, b: 0, i: 0 })
    expect(await as('ceo@demo.test', (tx) => tx`select amount from payment_entries where student_id = ${r.id}`)).toHaveLength(0)
    for (const e of ['edx.counsellor@demo.test', 'docs@demo.test', 'edx.finance@demo.test']) {
      expect(await refused(admin.listStaff(await ctxFor(e))), `${e} staff admin`).toBe(true)
      expect(await refused(security.listAlerts(await ctxFor(e))), `${e} alerts`).toBe(true)
    }
    await documents.documentAction(mgr, d.id, 'approve')
  })
})

describe('4. session and two-step security', () => {
  async function session(email: string, opts: { mfa?: boolean } = {}) {
    const [u] = await adminSql()`select id from user_profiles where email = ${email}`
    const token = newTokenValue()
    await adminSql()`select app.auth_create_session(${u.id}, ${hashToken(token)}, 12, '127.0.0.1', 'vitest', ${!!opts.mfa})`
    return { token, hash: hashToken(token), userId: u.id as string }
  }
  const resolve = async (hash: string) => (await anonymous((tx) => tx<{ mfa_pending: boolean }[]>`select * from app.auth_resolve_session(${hash})`))[0]

  it('revoked, expired and idle (8 h) sessions are refused; a session waiting for its 2-step code is flagged as not signed in', async () => {
    const a = await session('edx.counsellor@demo.test')
    expect(await resolve(a.hash)).toBeDefined()
    await anonymous((tx) => tx`select app.auth_revoke_session(${a.hash})`)
    expect(await resolve(a.hash)).toBeUndefined()
    const b = await session('edx.counsellor@demo.test')
    await adminSql()`update auth_private.sessions set expires_at = now() - interval '1 second' where token_hash = ${b.hash}`
    expect(await resolve(b.hash)).toBeUndefined()
    const c = await session('edx.counsellor@demo.test')
    await adminSql()`update auth_private.sessions set last_seen_at = now() - interval '8 hours 1 minute' where token_hash = ${c.hash}`
    expect(await resolve(c.hash)).toBeUndefined()
    const m = await session('edx.counsellor@demo.test', { mfa: true })
    expect((await resolve(m.hash))!.mfa_pending).toBe(true) // getSession() treats this as signed out
    // tokens are stored only as SHA-256 hashes
    expect(await adminSql()`select 1 from auth_private.sessions where token_hash = ${m.token}`).toHaveLength(0)
  })

  it('an authenticator code cannot be replayed; recovery codes work exactly once', async () => {
    const secret = newTotpSecret()
    const step = currentStep()
    expect(verifyTotp(secret, totp(secret, step), step - 2)).toBe(step)
    expect(verifyTotp(secret, totp(secret, step), step)).toBeNull() // already used
    expect(verifyTotp(secret, totp(secret, step - 5), 0)).toBeNull() // too old
    const s = await session('edx.counsellor2@demo.test', { mfa: true })
    const code = `RC${rand()}-${rand()}`
    await adminSql()`insert into auth_private.mfa_recovery_codes (user_id, code_hash) values (${s.userId}, ${hashRecoveryCode(code)})`
    const use = (hash: string) => anonymous((tx) => tx<{ ok: boolean }[]>`select app.auth_mfa_use_recovery(${hash}, ${hashRecoveryCode(code)}, 12) as ok`).then((r) => r[0].ok)
    expect(await use(s.hash)).toBe(true)
    const s2 = await session('edx.counsellor2@demo.test', { mfa: true })
    expect(await use(s2.hash)).toBe(false)
  })
})
