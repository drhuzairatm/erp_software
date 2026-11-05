/** Phase 1: employee notifications. Fictional data on the throwaway database. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mail = vi.hoisted(() => ({ configured: true, result: { sent: true } as { sent: boolean; testMode?: true }, sent: [] as { to: string; subject: string; text: string }[], throwIt: false }))
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  emailConfigured: () => mail.configured,
  sendEmail: async (to: string, subject: string, text: string) => {
    if (mail.throwIt) throw new Error('smtp down at internal.host')
    mail.sent.push({ to, subject, text })
    return mail.result
  },
}))

import { anonymous, db } from '@/lib/db'
import { deliverStaffNotificationEmails } from '@/lib/notifications/staff-notification-email'
import * as documents from '@/services/documents'
import * as notifications from '@/services/staff-notifications'
import * as students from '@/services/students'
import * as tasks from '@/services/tasks'
import { adminSql, as, ctxFor, expectDbError, orgId, securityClear, userId } from '../support/helpers'

let EDX: string; let GRD: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const MANAGER = 'edx.manager@demo.test'; const COUNSELLOR = 'edx.counsellor@demo.test'; const OTHER = 'edx.counsellor2@demo.test'
const unread = async (email: string) => (await notifications.listMyNotifications(await ctxFor(email), { unread: true })).rows
const forTask = <T extends { href: string }>(rows: T[], id: string) => rows.filter((r) => r.href === `/tasks/${id}`)
async function newTask(extra: Record<string, unknown> = {}, by = MANAGER) {
  const title = `Notify task ${rand()}`
  const id = await tasks.createTask(await ctxFor(by), { orgId: EDX, title, ...extra })
  return { id, title }
}
const clearEmailQueue = () => adminSql()`update staff_notifications set email_status = 'skipped' where email_status in ('pending', 'sending')`
const job = <T,>(fn: (tx: Parameters<Parameters<typeof anonymous>[0]>[0]) => Promise<T>) => anonymous(fn)

beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql().end(); await db().end() })

describe('events', () => {
  it('task assigned: the assignee is told; not the person who assigned it to themselves', async () => {
    const counsellor = await userId(COUNSELLOR)
    const { id, title } = await newTask({ assignedTo: counsellor })
    const [n] = forTask(await unread(COUNSELLOR), id)
    expect(n).toMatchObject({ event_key: 'task_assigned', title: 'A task was assigned to you', detail: title })
    const mine = await newTask({ assignedTo: await userId(MANAGER) })
    expect(forTask(await unread(MANAGER), mine.id)).toHaveLength(0)
  })

  it('reassignment tells the new assignee, and a comment tells assignee and creator but not its author', async () => {
    const mgr = await ctxFor(MANAGER)
    const { id } = await newTask({ assignedTo: await userId(COUNSELLOR) })
    await tasks.updateTask(mgr, id, { assignedTo: await userId(OTHER) })
    expect(forTask(await unread(OTHER), id).map((n) => n.event_key)).toEqual(['task_assigned'])
    await tasks.addTaskComment(await ctxFor(OTHER), id, 'A comment from the assignee')
    expect(forTask(await unread(MANAGER), id).map((n) => n.event_key)).toEqual(['task_comment'])
    expect(forTask(await unread(OTHER), id).map((n) => n.event_key)).toEqual(['task_assigned'])
  })

  it('completion tells the creator', async () => {
    const assignee = await ctxFor(COUNSELLOR)
    const { id } = await newTask({ assignedTo: assignee.userId })
    await tasks.updateTask(assignee, id, { status: 'completed' })
    expect(forTask(await unread(MANAGER), id).map((n) => n.event_key)).toEqual(['task_completed'])
  })

  it('document flow: approvers are told except the verifier and submitter; changes required tells assigned staff', async () => {
    const mgr = await ctxFor(MANAGER); const docs = await ctxFor('docs@demo.test')
    const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Notify Student Fictional', phone: `+91 90096 ${rand()}` })
    if (!r.ok) throw new Error('student not created')
    await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
    const item = (await documents.getChecklist(mgr, r.id)).items.find((i) => i.type_key === 'plus_two_certificate')!
    await documents.uploadDocument(docs, item.id, new File([new TextEncoder().encode(`%PDF-1.4\n% ${rand()}\n%%EOF`)], 'a.pdf', { type: 'application/pdf' }))
    await securityClear(item.id)
    for (const q of (await documents.getDocumentReview(docs, item.id))!.requirements.filter((x) => x.is_mandatory)) await documents.recordVerification(docs, item.id, q.id, 'present')
    await documents.documentAction(docs, item.id, 'verify'); await documents.documentAction(docs, item.id, 'submit')
    const href = `/students/${r.id}/documents/${item.id}`
    const managerRows = (await unread(MANAGER)).filter((n) => n.href === href)
    expect(managerRows.map((n) => n.event_key)).toEqual(['document_pending_approval'])
    expect((await unread('docs@demo.test')).filter((n) => n.href === href)).toHaveLength(0)
    // the text holds no personal data, and nobody in the other company is told
    expect(JSON.stringify(managerRows.map((n) => n.title))).not.toContain('Notify Student')
    expect((await unread('grd.manager@demo.test')).filter((n) => n.href === href)).toHaveLength(0)

    await documents.documentAction(mgr, item.id, 'request_changes', 'The scan is not readable')
    expect((await unread('docs@demo.test')).filter((n) => n.href === href).map((n) => n.event_key)).toEqual(['document_changes_required'])
  })
})

describe('isolation', () => {
  it('each person reads only their own; the MD and other staff see nothing of anyone else', async () => {
    const { id } = await newTask({ assignedTo: await userId(COUNSELLOR) })
    for (const e of [OTHER, 'md@demo.test', 'grd.manager@demo.test', 'admin@demo.test']) {
      expect(forTask((await notifications.listMyNotifications(await ctxFor(e))).rows, id), e).toHaveLength(0)
      expect(await as(e, (tx) => tx`select id from staff_notifications where href = ${`/tasks/${id}`}`), e).toHaveLength(0)
    }
    expect(await db()`select id from staff_notifications`).toHaveLength(0) // no signed-in user
  })

  it("someone else's notification can't be opened or marked as read", async () => {
    const { id } = await newTask({ assignedTo: await userId(COUNSELLOR) })
    const [n] = forTask(await unread(COUNSELLOR), id)
    expect(await notifications.openMyNotification(await ctxFor(OTHER), n.id)).toBeNull()
    await as(OTHER, (tx) => tx`select app.mark_staff_notifications_read(${[n.id]}::uuid[])`)
    expect(forTask(await unread(COUNSELLOR), id)).toHaveLength(1)
    await expectDbError(db()`select app.mark_staff_notifications_read(null)`, '42501')
  })

  it('reading is limited to a company where the person is still active', async () => {
    const { id } = await newTask({ assignedTo: await userId(COUNSELLOR) })
    const u = await userId(COUNSELLOR)
    await adminSql()`update organization_memberships set is_active = false where user_id = ${u} and org_id = ${EDX}`
    try {
      expect(await as(COUNSELLOR, (tx) => tx`select id from staff_notifications where href = ${`/tasks/${id}`}`)).toHaveLength(0)
    } finally {
      await adminSql()`update organization_memberships set is_active = true where user_id = ${u} and org_id = ${EDX}`
    }
  })

  it('the application role cannot write the table or read its email columns, and details follow current access', async () => {
    const u = await userId(COUNSELLOR)
    await expectDbError(as(COUNSELLOR, (tx) => tx`insert into staff_notifications (user_id, org_id, event_key, title, href) values (${u}, ${EDX}, 'task_assigned', 'x', '/')`), '42501')
    await expectDbError(as(COUNSELLOR, (tx) => tx`update staff_notifications set read_at = now()`), '42501')
    await expectDbError(as(COUNSELLOR, (tx) => tx`delete from staff_notifications`), '42501')
    await expectDbError(as(COUNSELLOR, (tx) => tx`select email_status from staff_notifications`), '42501')
    // after reassignment the earlier assignee keeps the notification but no longer gets the task title
    const { id } = await newTask({ assignedTo: u })
    await tasks.updateTask(await ctxFor(MANAGER), id, { assignedTo: await userId(OTHER) })
    const [n] = forTask(await unread(COUNSELLOR), id)
    expect(n.detail).toBeNull()
  })

  it('internal functions are closed; PUBLIC runs none of the new ones', async () => {
    for (const f of ['staff_notify(uuid, uuid, text, text, text, text, uuid, text, text, boolean)', 'staff_org_for_student(uuid, uuid)', 'student_document_approvers(uuid)', 'staff_notify_task()']) {
      const sig = `app.${f}`
      expect((await adminSql()`select has_function_privilege('erp_app', ${sig}::regprocedure, 'EXECUTE') as ok`)[0].ok, f).toBe(false)
    }
    const [{ n }] = await adminSql()`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace,
        lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where s.nspname = 'app' and a.grantee = 0 and (p.proname like 'staff_notif%' or p.proname like '%secure_file%')`
    expect(n).toBe(0)
  })
})

describe('reading', () => {
  it('open marks read and returns the internal page; mark all clears the count; the summary counts unread', async () => {
    const c = await ctxFor(COUNSELLOR)
    const { id } = await newTask({ assignedTo: c.userId })
    const [n] = forTask(await unread(COUNSELLOR), id)
    expect((await notifications.myNotificationSummary(c)).unread).toBeGreaterThan(0)
    expect(await notifications.openMyNotification(c, n.id)).toBe(`/tasks/${id}`)
    expect(forTask(await unread(COUNSELLOR), id)).toHaveLength(0)
    await notifications.markAllMyNotificationsRead(c)
    expect(await notifications.myNotificationSummary(c)).toEqual({ unread: 0, latest: [] })
    expect(forTask((await notifications.listMyNotifications(c)).rows, id)).toHaveLength(1) // history stays
  })

  it('the table refuses an address outside this application', async () => {
    const u = await userId(COUNSELLOR)
    for (const href of ['https://evil.example/', '//evil.example', 'javascript:alert(1)']) {
      await expect(adminSql()`insert into staff_notifications (user_id, org_id, event_key, title, href) values (${u}, ${EDX}, 'task_assigned', 'x', ${href})`, href).rejects.toMatchObject({ code: '23514' })
    }
  })

  it('a notification that cannot be created does not stop the action that raised it', async () => {
    const u = await userId(COUNSELLOR)
    await expect(adminSql()`select app.staff_notify(${u}, ${EDX}, 'not_an_event', 'x', '/tasks', null, null, 'info', null, false)`).resolves.toBeDefined()
    // someone who isn't a member of the company gets nothing
    const before = (await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${u} and org_id = ${GRD}`)[0].n
    await adminSql()`select app.staff_notify(${u}, ${GRD}, 'task_assigned', 'x', '/tasks', null, null, 'info', null, false)`
    expect((await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${u} and org_id = ${GRD}`)[0].n).toBe(before)
  })
})

describe('daily reminders', () => {
  const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)

  it('one reminder per task and due date, even when the job runs twice; old overdue tasks are not announced', async () => {
    const c = await userId(COUNSELLOR)
    const soon = await newTask({ assignedTo: c, dueDate: day(1) })
    const late = await newTask({ assignedTo: c, dueDate: day(-1) })
    const old = await newTask({ assignedTo: c, dueDate: day(-30) })
    const done = await newTask({ assignedTo: c, dueDate: day(-1), status: 'completed' })
    await job((tx) => tx`select app.staff_notifications_daily()`)
    await job((tx) => tx`select app.staff_notifications_daily()`)
    const rows = await unread(COUNSELLOR)
    expect(forTask(rows, soon.id).map((n) => n.event_key).sort()).toEqual(['task_assigned', 'task_due_soon'])
    expect(forTask(rows, late.id).map((n) => n.event_key).sort()).toEqual(['task_assigned', 'task_overdue'])
    expect(forTask(rows, old.id).map((n) => n.event_key)).toEqual(['task_assigned'])
    expect(forTask(rows, done.id).map((n) => n.event_key)).toEqual(['task_assigned'])
    // a new due date is a new reminder
    await tasks.updateTask(await ctxFor(MANAGER), late.id, { dueDate: day(-2) })
    await job((tx) => tx`select app.staff_notifications_daily()`)
    expect(forTask(await unread(COUNSELLOR), late.id).filter((n) => n.event_key === 'task_overdue')).toHaveLength(2)
  })

  it('the system jobs refuse a signed-in user', async () => {
    await expectDbError(as(MANAGER, (tx) => tx`select app.staff_notifications_daily()`), '42501')
    await expectDbError(as(MANAGER, (tx) => tx`select * from app.staff_notification_email_claim(5)`), '42501')
    await expectDbError(as(MANAGER, (tx) => tx`select app.staff_notification_email_finish(gen_random_uuid(), 'sent')`), '42501')
  })
})

describe('email', () => {
  const state = async (id: string) => (await adminSql()`select email_status, email_attempts, emailed_at, email_next_attempt_at from staff_notifications where href = ${`/tasks/${id}`} and event_key = 'task_assigned'`)[0]
  const reset = async () => { await clearEmailQueue(); mail.sent.length = 0; mail.result = { sent: true }; mail.configured = true; mail.throwIt = false }

  it('sends once, with generic text and a link only; a second run sends nothing', async () => {
    await reset()
    const { id, title } = await newTask({ assignedTo: await userId(COUNSELLOR) })
    expect(await deliverStaffNotificationEmails(50)).toEqual({ sent: 1, skipped: 0, retried: 0 })
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0].to).toBe(COUNSELLOR)
    expect(mail.sent[0].subject).toBe('A task was assigned to you')
    expect(mail.sent[0].text).toContain(`/tasks/${id}`)
    expect(mail.sent[0].text).not.toContain(title)
    expect((await state(id)).email_status).toBe('sent')
    expect(await deliverStaffNotificationEmails(50)).toEqual({ sent: 0, skipped: 0, retried: 0 })
  })

  it('parallel senders deliver each email exactly once', async () => {
    await reset()
    const c = await userId(COUNSELLOR)
    for (let i = 0; i < 6; i++) await newTask({ assignedTo: c })
    await Promise.all([deliverStaffNotificationEmails(50), deliverStaffNotificationEmails(50), deliverStaffNotificationEmails(50)])
    expect(mail.sent).toHaveLength(6)
  })

  it('test mode is skipped and never retried', async () => {
    await reset(); mail.result = { sent: false, testMode: true }
    const { id } = await newTask({ assignedTo: await userId(COUNSELLOR) })
    expect(await deliverStaffNotificationEmails(50)).toMatchObject({ skipped: 1 })
    expect((await state(id)).email_status).toBe('skipped')
  })

  it('a temporary failure retries with a delay, fails after 5 attempts, and stores no provider error', async () => {
    await reset(); mail.throwIt = true
    const { id } = await newTask({ assignedTo: await userId(COUNSELLOR) })
    for (let i = 1; i <= 5; i++) {
      expect(await deliverStaffNotificationEmails(50)).toMatchObject({ retried: 1 })
      const s = await state(id)
      expect(s.email_attempts).toBe(i)
      if (i < 5) {
        expect(s.email_status).toBe('pending')
        expect(s.email_next_attempt_at.getTime()).toBeGreaterThan(Date.now())
        expect(await deliverStaffNotificationEmails(50)).toMatchObject({ retried: 0 }) // not before the delay
        await adminSql()`update staff_notifications set email_next_attempt_at = now() where href = ${`/tasks/${id}`}`
      }
    }
    expect((await state(id)).email_status).toBe('failed')
    const columns = await adminSql()`select column_name from information_schema.columns where table_name = 'staff_notifications' and column_name like '%error%'`
    expect(columns).toHaveLength(0)
  })

  it('email not configured: nothing is claimed; stale mail, suspended accounts and read-only events are never sent', async () => {
    await reset(); mail.configured = false
    const c = await userId(COUNSELLOR)
    const { id } = await newTask({ assignedTo: c })
    expect(await deliverStaffNotificationEmails(50)).toMatchObject({ sent: 0, reason: 'email not configured' })
    expect((await state(id)).email_status).toBe('pending')
    mail.configured = true
    await adminSql()`update staff_notifications set created_at = now() - interval '25 hours' where href = ${`/tasks/${id}`}`
    expect(await deliverStaffNotificationEmails(50)).toMatchObject({ sent: 0 })
    expect((await state(id)).email_status).toBe('skipped')
    const other = await newTask({ assignedTo: c })
    await adminSql()`update user_profiles set account_status = 'suspended', suspension_reason = 'Fictional test of notification email' where id = ${c}`.catch(async () => {
      await adminSql()`update user_profiles set account_status = 'suspended' where id = ${c}`
    })
    try {
      expect(await deliverStaffNotificationEmails(50)).toMatchObject({ sent: 0 })
      expect((await state(other.id)).email_status).toBe('skipped')
    } finally {
      await adminSql()`update user_profiles set account_status = 'active' where id = ${c}`
    }
    await adminSql()`update user_profiles set suspension_reason = null where id = ${c}`.catch(() => {})
    expect(mail.sent).toHaveLength(0)
  })
})
