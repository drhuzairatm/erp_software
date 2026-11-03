import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/server/db'
import { ServiceError } from '@/server/errors'
import * as dashboard from '@/server/services/dashboard'
import * as documents from '@/server/services/documents'
import * as payments from '@/server/services/payments'
import * as reports from '@/server/services/reports'
import * as students from '@/server/services/students'
import * as tasks from '@/server/services/tasks'
import { verifyLocalSignature } from '@/server/storage'
import { adminSql, as, ctxFor, expectDbError, orgId, studentWhere } from '../support/helpers'

let EDX: string, GRD: string
beforeAll(async () => {
  EDX = await orgId('EDX')
  GRD = await orgId('GRD')
})
afterAll(async () => {
  await adminSql().end()
  await db().end()
})

async function expectServiceError(p: Promise<unknown>, kind: string) {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceError)
    expect((e as ServiceError).kind).toBe(kind)
    return e as ServiceError
  }
  throw new Error(`expected ServiceError(${kind}) but succeeded`)
}

const newStudent = (over: Record<string, unknown> = {}) => ({
  originatingOrgId: EDX, fullName: 'Test Student Alpha', phone: `+91 90000 ${String(Math.floor(Math.random() * 90000) + 10000)}`,
  phone2: `+91 90020 ${String(Math.floor(Math.random() * 90000) + 10000)}`,
  email: `alpha.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.test`, ...over,
})

describe('students', () => {
  it('creates a student with a unique server-generated Student ID and a document checklist', async () => {
    const ctx = await ctxFor('edx.counsellor@demo.test')
    const a = await students.createStudent(ctx, newStudent({ studentCode: 'HACK-1' }))
    const b = await students.createStudent(ctx, newStudent())
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    const rows = await adminSql()`select student_code from students where id in (${a.id}, ${b.id})`
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.student_code).toMatch(/^EDX-\d{2}-\d{6}$/)
    expect(rows[0].student_code).not.toBe(rows[1].student_code)
    const docs = await adminSql()`select count(*)::int as n from student_documents where student_id = ${a.id}`
    expect(docs[0].n).toBeGreaterThan(0)
    // the registering counsellor is assigned automatically
    const p = await students.getStudent(ctx, a.id)
    expect(p?.assignments.find((x) => x.assignment_type === 'counsellor')?.user_id).toBe(ctx.userId)
  })

  it('validates input', async () => {
    const ctx = await ctxFor('edx.counsellor@demo.test')
    const e = await expectServiceError(students.createStudent(ctx, { originatingOrgId: EDX, fullName: 'X' }), 'invalid')
    expect(e.fieldErrors).toHaveProperty('fullName')
    expect(e.fieldErrors).toHaveProperty('phone')
  })

  it('refuses to register students for a company the user does not belong to', async () => {
    const ctx = await ctxFor('edx.counsellor@demo.test')
    await expectServiceError(students.createStudent(ctx, newStudent({ originatingOrgId: GRD })), 'forbidden')
  })

  it('warns about duplicates; hides another brand\'s record details', async () => {
    const edxCtx = await ctxFor('edx.counsellor@demo.test')
    const phone = '+91 90000 77711'
    const first = await students.createStudent(edxCtx, newStudent({ phone }))
    expect(first.ok).toBe(true)
    const same = await students.createStudent(edxCtx, newStudent({ phone }))
    expect(same.ok).toBe(false)
    if (!same.ok) expect(same.duplicates[0]).toMatchObject({ visible: true, matched_on: 'phone' })
    const grdCtx = await ctxFor('grd.counsellor@demo.test')
    const cross = await students.createStudent(grdCtx, newStudent({ originatingOrgId: GRD, phone }))
    expect(cross.ok).toBe(false)
    if (!cross.ok) {
      expect(cross.duplicates[0]).toMatchObject({ visible: false, student_id: null, full_name: null, org_name: 'Dr.Expert Edulinks' })
    }
    const confirmed = await students.createStudent(grdCtx, newStudent({ originatingOrgId: GRD, phone, confirmDuplicate: 'yes' }))
    expect(confirmed.ok).toBe(true)
  })

  it('edits a student and records the change in the timeline and audit log', async () => {
    const ctx = await ctxFor('edx.counsellor@demo.test')
    const r = await students.createStudent(ctx, newStudent())
    if (!r.ok) throw new Error('create failed')
    await students.updateStudent(ctx, r.id, newStudent({ fullName: 'Test Student Renamed', phone: '+91 90000 55501' }))
    const tl = await students.getTimeline(ctx, r.id)
    expect(tl.some((e) => e.summary.includes('Details updated') && e.summary.includes('name'))).toBe(true)
    const audit = await adminSql()`select before_data, after_data from audit_logs where entity_type = 'students' and entity_id = ${r.id} and action = 'update'`
    expect(audit.some((a) => a.after_data?.full_name === 'Test Student Renamed')).toBe(true)
  })

  it('users without contact permission cannot erase contact details by editing', async () => {
    const s = await studentWhere(`o.code = 'EDX' and s.status = 'active' and s.current_stage_key = 'document_collection'`)
    const [before] = await adminSql()`select phone, email from students where id = ${s.id}`
    // documentation staff have students.read.assigned but neither update nor contact permissions
    const docs = await ctxFor('docs@demo.test')
    await expectServiceError(students.updateStudent(docs, s.id, { originatingOrgId: EDX, fullName: 'Changed', phone: '+91 90000 00000' }), 'forbidden').catch(async () => {
      // either forbidden or not found is acceptable as long as nothing changed
    })
    const [after] = await adminSql()`select phone, email, full_name from students where id = ${s.id}`
    expect(after.phone).toBe(before.phone)
    expect(after.full_name).not.toBe('Changed')
  })

  it('search finds by Student ID, name and phone (only with contact permission)', async () => {
    const s = await studentWhere(`o.code = 'EDX' and s.is_demo`)
    const mgr = await ctxFor('edx.manager@demo.test')
    const byCode = await students.listStudents(mgr, [EDX], { q: s.student_code })
    expect(byCode.rows.map((r) => r.id)).toContain(s.id)
    const [{ phone }] = await adminSql()`select phone from students where id = ${s.id}`
    const byPhone = await students.listStudents(mgr, [EDX], { q: phone })
    expect(byPhone.rows.map((r) => r.id)).toContain(s.id)
    const finance = await ctxFor('edx.finance@demo.test') // no contact permission
    const finByPhone = await students.listStudents(finance, [EDX], { q: phone })
    expect(finByPhone.rows.map((r) => r.id)).not.toContain(s.id)
  })

  it('getStudent returns null for another company\'s student (guessed id)', async () => {
    const edx = await studentWhere(`o.code = 'EDX'`)
    expect(await students.getStudent(await ctxFor('grd.manager@demo.test'), edx.id)).toBeNull()
    expect(await students.getStudent(await ctxFor('grd.manager@demo.test'), 'not-a-uuid')).toBeNull()
  })
})

describe('admission workflow', () => {
  it('counsellors cannot move a student into visa stages', async () => {
    const ctx = await ctxFor('edx.counsellor@demo.test')
    const r = await students.createStudent(ctx, newStudent())
    if (!r.ok) throw new Error()
    await expectServiceError(students.changeStage(ctx, r.id, { toStage: 'visa_processing', acknowledge: 'yes' }), 'forbidden')
  })

  it('requires acknowledging warnings, records history with previous/new stage, user and reason', async () => {
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    // passport valid for more than 12 months (business rule from University Application)
    const r = await students.createStudent(counsellor, newStudent({ passportNumber: `PS${Date.now().toString().slice(-6)}`, passportExpiry: '2032-01-01' }))
    if (!r.ok) throw new Error()
    expect(await students.changeStage(counsellor, r.id, { toStage: 'registration', nextAction: 'Collect documents', nextActionDue: '2030-01-10' })).toEqual({ ok: true })
    const mgr = await ctxFor('edx.manager@demo.test')
    const first = await students.changeStage(mgr, r.id, { toStage: 'university_application' })
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.warnings.join(' ')).toMatch(/required document/)
    expect(await students.changeStage(mgr, r.id, { toStage: 'university_application', reason: 'Fast-track (test)', acknowledge: 'yes' })).toEqual({ ok: true })
    const p = await students.getStudent(mgr, r.id)
    expect(p?.student.current_stage_key).toBe('university_application')
    expect(p?.history[0]).toMatchObject({ from_stage: 'registration', to_stage: 'university_application', reason: 'Fast-track (test)' })
    expect(p?.history[0].changed_by_name).toContain('Rahul')
    expect(p?.history[0].warnings.length).toBeGreaterThan(0)
    expect(p?.history[1]).toMatchObject({ from_stage: 'lead', to_stage: 'registration', next_action: 'Collect documents' })
  })

  it('On Hold and Cancelled require a reason; resuming returns to an earlier stage', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const r = await students.createStudent(mgr, newStudent())
    if (!r.ok) throw new Error()
    await expectServiceError(students.changeStage(mgr, r.id, { toStage: 'on_hold' }), 'invalid')
    await students.changeStage(mgr, r.id, { toStage: 'on_hold', reason: 'Family reasons' })
    let p = await students.getStudent(mgr, r.id)
    expect(p?.student.status).toBe('on_hold')
    expect(p?.student.stage_before_hold).toBe('lead')
    expect(await students.changeStage(mgr, r.id, { toStage: 'registration' })).toEqual({ ok: true })
    p = await students.getStudent(mgr, r.id)
    expect(p?.student.status).toBe('active')
  })

  it('blocks stages that are not part of the student\'s workflow', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const [ge] = await adminSql()`select id from countries where code = 'GE'`
    const [mbbs] = await adminSql()`select id from courses where code = 'MBBS'`
    const r = await students.createStudent(mgr, newStudent({ destinationCountryId: ge.id, courseId: mbbs.id }))
    if (!r.ok) throw new Error()
    await expectServiceError(students.changeStage(mgr, r.id, { toStage: 'translation', acknowledge: 'yes' }), 'invalid')
  })

  it('stage cannot be changed by a direct database update', async () => {
    const s = await studentWhere(`o.code = 'EDX' and s.status = 'active'`)
    await expectDbError(as('edx.manager@demo.test', (tx) => tx`update students set current_stage_key = 'travel_completed' where id = ${s.id}`), '42501')
  })
})

describe('documents', () => {
  async function freshDoc() {
    const mgr = await ctxFor('edx.manager@demo.test')
    const r = await students.createStudent(mgr, newStudent())
    if (!r.ok) throw new Error()
    const cl = await documents.getChecklist(mgr, r.id)
    return { mgr, studentId: r.id, doc: cl.items.find((i) => i.type_key === 'passport')! }
  }
  const pdf = () => new File([Buffer.from('%PDF-1.4\n%fictional test\n')], 'passport scan.pdf', { type: 'application/pdf' })

  it('upload sets status Uploaded (never Approved) and keeps version history', async () => {
    const { mgr, studentId, doc } = await freshDoc()
    await documents.uploadDocument(mgr, doc.id, pdf())
    await documents.uploadDocument(mgr, doc.id, pdf())
    const cl = await documents.getChecklist(mgr, studentId)
    const d = cl.items.find((i) => i.id === doc.id)!
    expect(d.status).toBe('uploaded')
    expect(d.current_version).toBe(2)
    expect(cl.files.filter((f) => f.student_document_id === doc.id)).toHaveLength(2)
  })

  it('rejects disguised or oversized files', async () => {
    const { mgr, doc } = await freshDoc()
    const fakePdf = new File([Buffer.from('MZ\x90\x00 executable')], 'cv.pdf', { type: 'application/pdf' })
    await expectServiceError(documents.uploadDocument(mgr, doc.id, fakePdf), 'invalid')
    const big = new File([Buffer.alloc(10 * 1024 * 1024 + 1, 0x25)], 'big.pdf', { type: 'application/pdf' })
    await expectServiceError(documents.uploadDocument(mgr, doc.id, big), 'invalid')
  })

  it('review rules: reasons required; nothing to review without a file; counsellors cannot review', async () => {
    const { mgr, doc } = await freshDoc()
    await expectServiceError(documents.documentAction(mgr, doc.id, 'verify'), 'invalid')
    await documents.uploadDocument(mgr, doc.id, pdf())
    await expectServiceError(documents.documentAction(mgr, doc.id, 'reject', ''), 'invalid')
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    await expectServiceError(documents.documentAction(counsellor, doc.id, 'start_review'), 'forbidden')
    await documents.documentAction(mgr, doc.id, 'request_changes', 'Blurred scan')
  })

  it('only staff with download permission get a short-lived signed URL; others get nothing and the attempt is audited', async () => {
    const { mgr, doc, studentId } = await freshDoc()
    await documents.uploadDocument(mgr, doc.id, pdf())
    const cl = await documents.getChecklist(mgr, studentId)
    const fileId = cl.items.find((i) => i.id === doc.id)!.current_file_id!
    const url = await documents.openFile(mgr, fileId)
    expect(url).toMatch(/^\/api\/storage\/local\?/)
    const q = new URL('http://x' + url).searchParams
    expect(Number(q.get('e')) - Date.now() / 1000).toBeLessThanOrEqual(61)
    expect(verifyLocalSignature(q.get('k')!, Number(q.get('e')), q.get('f')!, q.get('t')!, q.get('s')!)).toBe(true)
    expect(verifyLocalSignature(q.get('k')!, Number(q.get('e')), q.get('f')!, q.get('t')!, q.get('s')!.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBe(false)
    // counsellor (no documents.file.view), other company manager, and finance: denied
    for (const email of ['edx.counsellor@demo.test', 'grd.manager@demo.test', 'edx.finance@demo.test']) {
      expect(await documents.openFile(await ctxFor(email), fileId)).toBeNull()
    }
    const denied = await adminSql()`select count(*)::int as n from audit_logs where action = 'file_download' and entity_id = ${fileId} and outcome = 'denied'`
    expect(denied[0].n).toBe(3)
  })
})

describe('tasks', () => {
  it('assignee can update status but cannot reassign; manager reassignment is recorded', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const docs = await ctxFor('docs@demo.test')
    const docs2 = await ctxFor('docs2@demo.test')
    const id = await tasks.createTask(mgr, { orgId: EDX, title: 'Test task', assignedTo: docs.userId, dueDate: '2020-01-01' })
    const overdue = await tasks.listTasks(docs, [EDX], { view: 'overdue', mine: 'yes' })
    expect(overdue.rows.map((r) => r.id)).toContain(id)
    await tasks.updateTask(docs, id, { status: 'waiting_external', delayReason: 'embassy' })
    await expectServiceError(tasks.updateTask(docs, id, { assignedTo: docs2.userId }), 'forbidden')
    await tasks.updateTask(mgr, id, { assignedTo: docs2.userId })
    const t = await tasks.getTask(mgr, id)
    expect(t?.events.map((e) => e.event_type)).toEqual(expect.arrayContaining(['created', 'assigned', 'status', 'reassigned']))
    expect(t?.task.assignee_name).toContain('Reshma')
    await tasks.updateTask(docs2, id, { status: 'completed' })
    expect((await tasks.getTask(mgr, id))?.task.completed_at).toBeTruthy()
  })

  it('waiting on an external party requires a reason', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    await expectServiceError(tasks.createTask(mgr, { orgId: EDX, title: 'Waiting', status: 'waiting_external' }), 'invalid')
  })

  it('cannot assign a task to someone outside the company', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const grdUser = await ctxFor('grd.counsellor@demo.test')
    await expectServiceError(tasks.createTask(mgr, { orgId: EDX, title: 'Cross', assignedTo: grdUser.userId }), 'invalid')
  })
})

describe('payments', () => {
  async function studentWithCharge() {
    const mgr = await ctxFor('edx.manager@demo.test')
    const r = await students.createStudent(mgr, newStudent())
    if (!r.ok) throw new Error()
    const fin = await ctxFor('edx.finance@demo.test')
    const cats = await adminSql()`select id, key from fee_categories where org_id = ${EDX}`
    const cat = (k: string) => cats.find((c) => c.key === k)!.id
    await payments.recordEntry(fin, r.id, { orgId: EDX, entryType: 'charge', feeCategoryId: cat('service_fee'), amount: '100000', entryDate: '2026-10-01' })
    return { id: r.id, fin, cat }
  }
  const balance = async (ctxEmail: string, id: string) =>
    (await payments.studentLedger(await ctxFor(ctxEmail), id)).balances.find((b) => b.ledger === 'service')

  it('a receipt counts only after verification by a different staff member', async () => {
    const { id, fin, cat } = await studentWithCharge()
    const rec = await payments.recordEntry(fin, id, { orgId: EDX, entryType: 'receipt', feeCategoryId: cat('service_fee'), amount: '40000', entryDate: '2026-10-02', method: 'upi', referenceNo: 'UTR123' })
    let b = await balance('edx.finance@demo.test', id)
    expect(b).toMatchObject({ amount_due: '100000.00', amount_received: '0.00', outstanding: '100000.00', pending_receipts: '40000.00' })
    await expectServiceError(payments.verifyEntry(fin, rec, 'verified'), 'forbidden') // self-verification blocked
    await payments.verifyEntry(await ctxFor('edx.finance2@demo.test'), rec, 'verified')
    b = await balance('edx.finance@demo.test', id)
    expect(b).toMatchObject({ amount_received: '40000.00', outstanding: '60000.00', pending_receipts: '0.00' })
  })

  it('third-party money is kept separate from service balances', async () => {
    const { id, fin, cat } = await studentWithCharge()
    const r = await payments.recordEntry(fin, id, { orgId: EDX, entryType: 'receipt', feeCategoryId: cat('university_fee'), amount: '300000', entryDate: '2026-10-02', method: 'bank_transfer' })
    await payments.verifyEntry(await ctxFor('edx.finance2@demo.test'), r, 'verified')
    const d = await payments.recordEntry(fin, id, { orgId: EDX, entryType: 'disbursement', feeCategoryId: cat('university_fee'), amount: '300000', entryDate: '2026-10-03', method: 'bank_transfer', payee: 'Test University' })
    await payments.verifyEntry(await ctxFor('edx.finance2@demo.test'), d, 'verified')
    const { balances } = await payments.studentLedger(fin, id)
    expect(balances.find((b) => b.ledger === 'service')?.outstanding).toBe('100000.00')
    expect(balances.find((b) => b.ledger === 'third_party')).toMatchObject({ amount_received: '300000.00', amount_disbursed: '300000.00', held_balance: '0.00' })
    await expectServiceError(payments.recordEntry(fin, id, { orgId: EDX, entryType: 'disbursement', feeCategoryId: cat('service_fee'), amount: '1', entryDate: '2026-10-03', payee: 'x' }), 'invalid')
  })

  it('entries cannot be edited or deleted; reversals preserve history and correct the balance', async () => {
    const { id, fin } = await studentWithCharge()
    const [entry] = await adminSql()`select id from payment_entries where student_id = ${id}`
    await expectDbError(as('edx.finance@demo.test', (tx) => tx`update payment_entries set amount = 1 where id = ${entry.id}`), '42501')
    await expectDbError(as('edx.finance@demo.test', (tx) => tx`delete from payment_entries where id = ${entry.id}`), '42501')
    await expectDbError(adminSql()`update payment_entries set amount = 1 where id = ${entry.id}`, '42501')
    await payments.reverseEntry(fin, entry.id, 'Charged in error')
    let b = await balance('edx.finance@demo.test', id)
    expect(b?.outstanding).toBe('100000.00') // reversal pending verification
    const [rev] = await adminSql()`select id from payment_entries where reverses_entry_id = ${entry.id}`
    await payments.verifyEntry(await ctxFor('edx.finance2@demo.test'), rev.id, 'verified')
    b = await balance('edx.finance@demo.test', id)
    expect(b?.outstanding).toBe('0.00')
    const all = await adminSql()`select count(*)::int as n from payment_entries where student_id = ${id}`
    expect(all[0].n).toBe(2)
  })

  it('counsellors and other companies cannot see or record payments', async () => {
    const { id } = await studentWithCharge()
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    expect((await payments.studentLedger(counsellor, id)).entries).toHaveLength(0)
    const cats = await adminSql()`select id from fee_categories where org_id = ${EDX} limit 1`
    await expectServiceError(payments.recordEntry(counsellor, id, { orgId: EDX, entryType: 'charge', feeCategoryId: cats[0].id, amount: '5', entryDate: '2026-10-01' }), 'forbidden')
    await expectServiceError(payments.listLedger(await ctxFor('grd.finance@demo.test'), [EDX], {}), 'forbidden')
  })
})

describe('dashboard and reports', () => {
  it('dashboard figures match the database and respect company scope', async () => {
    const md = await ctxFor('md@demo.test')
    const both = await dashboard.getDashboard(md, [EDX, GRD], {})
    const [actual] = await adminSql()`select count(*)::int as n from students where status = 'active' and archived_at is null`
    expect(both.cards.active).toBe(actual.n)
    const edxOnly = await dashboard.getDashboard(md, [EDX], {})
    const grdOnly = await dashboard.getDashboard(md, [GRD], {})
    const [edxActual] = await adminSql()`select count(*)::int as n from students s where status = 'active' and archived_at is null
      and exists (select 1 from student_org_access a where a.student_id = s.id and a.org_id = ${EDX})`
    expect(edxOnly.cards.active).toBe(edxActual.n)
    expect(grdOnly.cards.active).toBeLessThan(both.cards.active)
    const [overdue] = await adminSql()`select count(*)::int as n from tasks where org_id in (${EDX}, ${GRD}) and status in ('not_started','in_progress') and due_date < current_date`
    expect(both.tasks.overdue_internal).toBe(overdue.n)
    expect(both.canFinance).toBe(true)
  })

  it('filters narrow the figures', async () => {
    const md = await ctxFor('md@demo.test')
    const [ru] = await adminSql()`select id from countries where code = 'RU'`
    const all = await dashboard.getDashboard(md, [EDX, GRD], {})
    const russia = await dashboard.getDashboard(md, [EDX, GRD], { country: ru.id })
    const [n] = await adminSql()`select count(*)::int as n from students where status = 'active' and archived_at is null and destination_country_id = ${ru.id}`
    expect(russia.cards.active).toBe(n.n)
    expect(russia.cards.active).toBeLessThan(all.cards.active)
  })

  it('a GRADUATER manager\'s dashboard never includes Edulinks-only students', async () => {
    const mgr = await ctxFor('grd.manager@demo.test')
    const d = await dashboard.getDashboard(mgr, [GRD, EDX], {}) // even if EDX is requested
    const [n] = await adminSql()`select count(*)::int as n from students where originating_org_id = ${GRD} and status = 'active' and archived_at is null`
    expect(d.cards.active).toBe(n.n)
  })

  it('CSV export: permissions enforced, audited, formula injection neutralised', async () => {
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    await expectServiceError(reports.exportReport(counsellor, 'student-list', [EDX], {}), 'not_found')
    const finance = await ctxFor('edx.finance@demo.test')
    await expectServiceError(reports.exportReport(finance, 'student-list', [EDX], {}), 'forbidden') // PII export not allowed
    const ok = await reports.exportReport(finance, 'balances', [EDX], {})
    expect(ok.csv.split('\r\n')[0]).toContain('Outstanding')
    const audits = await adminSql()`select outcome from audit_logs where action = 'export' and entity_id in ('student-list', 'balances') and actor_user_id = ${finance.userId}`
    expect(audits.map((a) => a.outcome).sort()).toEqual(['denied', 'success'])
    const md = await ctxFor('md@demo.test')
    const grdOnly = await reports.exportReport(await ctxFor('grd.manager@demo.test'), 'student-list', [GRD], {})
    expect(grdOnly.csv).not.toMatch(/EDX-\d{2}-/)
    expect((await reports.exportReport(md, 'student-list', [EDX, GRD], {})).csv).toMatch(/EDX-\d{2}-/)
    expect(reports.toCsv([{ key: 'a', label: 'A' }], [{ a: '=HYPERLINK("x")' }, { a: '-42' }])).toBe('﻿A\r\n"\'=HYPERLINK(""x"")"\r\n-42\r\n')
  })
})
