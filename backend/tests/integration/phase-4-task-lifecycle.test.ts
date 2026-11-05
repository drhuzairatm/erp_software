/** Phase 4: task lifecycle on the existing tasks table. Fictional data. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as secure from '@/services/secure-files'
import * as tasks from '@/services/tasks'
import { adminSql, as, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string; let GRD: string
const MGR = 'edx.manager@demo.test'; const EMP = 'edx.counsellor@demo.test'; const OTHER = 'edx.counsellor2@demo.test'; const GMGR = 'grd.manager@demo.test'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
const pdf = () => new File([new TextEncoder().encode(`%PDF-1.4\n% ${rand()}\n%%EOF`)], 'evidence.pdf', { type: 'application/pdf' })
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
async function refuses(p: Promise<unknown>, text?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (text) expect(`${(e as ServiceError).kind} ${(e as ServiceError).message}`).toContain(text); return }
  throw new Error('expected a refusal')
}
const newTask = async (extra: Record<string, unknown> = {}) => tasks.createTask(await ctxFor(MGR), { orgId: EDX, title: `Lifecycle ${rand()}`, assignedTo: await userId(EMP), requiresReview: 'on', priority: 'urgent', dueDate: future(3), dueTime: '17:30', startDate: future(1), completionInstructions: 'Fictional instructions', ...extra })
beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql().end() })

describe('creating', () => {
  it('stores deadline with time, start date, instructions, who assigned and when', async () => {
    const id = await newTask()
    const [t] = await adminSql()`select *, to_char(due_at at time zone 'Asia/Kolkata', 'HH24:MI') as hhmm from tasks where id = ${id}`
    expect(t).toMatchObject({ hhmm: '17:30', status: 'not_started', priority: 'urgent', requires_review: true, assigned_by: await userId(MGR) })
    expect(t.assigned_at).toBeTruthy(); expect(t.original_due_at).toEqual(t.due_at)
    const got = await tasks.getTask(await ctxFor(MGR), id)
    expect(got?.task.completion_instructions).toBe('Fictional instructions')
  })
  it('a date-only task is overdue only after that date ends in India time', async () => {
    const [{ today }] = await adminSql()`select (now() at time zone 'Asia/Kolkata')::date::text as today`
    const id = await newTask({ dueDate: today, dueTime: '' })
    expect((await tasks.getTask(await ctxFor(MGR), id))?.task.is_overdue).toBe(false)
  })
})

describe('submit and approve', () => {
  it('the assignee cannot complete a review task; submits; the manager approves', async () => {
    const id = await newTask()
    const emp = await ctxFor(EMP); const mgr = await ctxFor(MGR)
    await tasks.updateTask(emp, id, { status: 'in_progress', progressPercent: 40 })
    await refuses(tasks.updateTask(emp, id, { status: 'completed' }), 'forbidden')
    await refuses(tasks.reviewTask(mgr, id, 'approved'), 'not waiting')
    await tasks.submitTask(emp, id, 'Fictional: done')
    let t = (await tasks.getTask(mgr, id))!
    expect(t.task.status).toBe('submitted'); expect(t.permissions.review).toBe(true)
    const [n] = await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${mgr.userId} and event_key = 'task_submitted' and subject_id = ${id}`
    expect(n.n).toBe(1)
    await refuses(tasks.reviewTask(emp, id, 'approved'), 'forbidden')
    await refuses(tasks.reviewTask(await ctxFor(OTHER), id, 'approved'))
    await refuses(tasks.reviewTask(await ctxFor(GMGR), id, 'approved'))
    await tasks.reviewTask(mgr, id, 'approved', 'Fictional: good')
    t = (await tasks.getTask(mgr, id))!
    expect(t.task).toMatchObject({ status: 'completed', progress_percent: 100, completed_late: false })
    expect(t.reviews.map((r) => r.decision)).toEqual(['submitted', 'approved'])
  })

  it('corrections return it to in progress with a required note; it can be resubmitted', async () => {
    const id = await newTask(); const emp = await ctxFor(EMP); const mgr = await ctxFor(MGR)
    await tasks.submitTask(emp, id)
    await refuses(tasks.reviewTask(mgr, id, 'corrections'), 'correcting')
    await tasks.reviewTask(mgr, id, 'corrections', 'Fictional: redo section 2')
    let t = (await tasks.getTask(emp, id))!
    expect(t.task).toMatchObject({ status: 'in_progress', correction_count: 1, submitted_at: null })
    const [n] = await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${emp.userId} and event_key = 'task_corrections' and subject_id = ${id}`
    expect(n.n).toBe(1)
    await tasks.submitTask(emp, id, 'Second try')
    t = (await tasks.getTask(emp, id))!
    expect(t.reviews.map((r) => r.decision)).toEqual(['submitted', 'corrections', 'submitted'])
  })

  it('evidence: required before submitting; only the assignee submits; a status cannot jump to submitted', async () => {
    const id = await newTask({ evidenceRequired: 'on' }); const emp = await ctxFor(EMP)
    await refuses(tasks.submitTask(emp, id), 'evidence')
    await refuses(tasks.submitTask(await ctxFor(MGR), id), 'forbidden')
    await secure.uploadSecureFile(emp, 'task', id, pdf())
    await tasks.submitTask(emp, id)
    expect((await tasks.getTask(emp, id))?.task.status).toBe('submitted')
    const other = await newTask()
    await expectDbError(as(EMP, (tx) => tx`update tasks set status = 'submitted' where id = ${other}`), '23514')
    await expectDbError(as(EMP, (tx) => tx`update tasks set submitted_at = now(), overdue_at = null where id = ${other}`), '42501')
  })

  it('tasks without review keep the existing way of completing', async () => {
    const id = await tasks.createTask(await ctxFor(MGR), { orgId: EDX, title: `Plain ${rand()}`, assignedTo: await userId(EMP) })
    await tasks.updateTask(await ctxFor(EMP), id, { status: 'completed' })
    expect((await tasks.getTask(await ctxFor(EMP), id))?.task.status).toBe('completed')
  })
})

describe('deadlines', () => {
  it('an extension keeps the original deadline, and records actor, time, new deadline and reason', async () => {
    const id = await newTask(); const mgr = await ctxFor(MGR)
    const [{ original }] = await adminSql()`select due_at as original from tasks where id = ${id}`
    await refuses(tasks.extendTask(await ctxFor(EMP), id, future(10), '10:00', 'Too long'), 'forbidden')
    await refuses(tasks.extendTask(mgr, id, future(10), '10:00', ''), 'reason')
    await refuses(tasks.extendTask(mgr, id, '2020-01-01', '10:00', 'In the past'), 'future')
    await tasks.extendTask(mgr, id, future(10), '10:00', 'Fictional: waiting for a document')
    const [t] = await adminSql()`select original_due_at, due_at from tasks where id = ${id}`
    expect(t.original_due_at).toEqual(original); expect(t.due_at).not.toEqual(original)
    const [x] = (await tasks.getTask(mgr, id))!.extensions
    expect(x).toMatchObject({ reason: 'Fictional: waiting for a document', actor: expect.any(String) })
    expect(x.previous_due).toEqual(original)
  })

  it('a date change on the existing form is recorded as an extension too', async () => {
    const id = await newTask(); const mgr = await ctxFor(MGR)
    await tasks.updateTask(mgr, id, { dueDate: future(5) })
    expect((await tasks.getTask(mgr, id))!.extensions[0].reason).toBe('Changed on the task form')
  })

  it('the breach is recorded by the job; late completion and later extension do not erase it', async () => {
    const id = await newTask(); const mgr = await ctxFor(MGR); const emp = await ctxFor(EMP)
    const past = new Date(Date.now() - 3600000)
    await adminSql()`alter table tasks disable trigger tasks_lifecycle_before`
    await adminSql()`update tasks set due_at = ${past}, due_date = ${past.toISOString().slice(0, 10)} where id = ${id}`
    await adminSql()`alter table tasks enable trigger tasks_lifecycle_before`
    expect((await tasks.getTask(mgr, id))?.task.is_overdue).toBe(true)
    await anonymous((tx) => tx`select app.task_reminders_tick()`)
    const [a] = await adminSql()`select overdue_at from tasks where id = ${id}`
    expect(a.overdue_at).toBeTruthy()
    await tasks.extendTask(mgr, id, future(2), '10:00', 'Fictional: extended after the breach')
    expect((await adminSql()`select overdue_at from tasks where id = ${id}`)[0].overdue_at).toEqual(a.overdue_at)
    expect((await tasks.getTask(mgr, id))?.task.is_overdue).toBe(false)
    await tasks.submitTask(emp, id); await tasks.reviewTask(mgr, id, 'approved')
    expect((await adminSql()`select overdue_at, status from tasks where id = ${id}`)[0]).toEqual({ overdue_at: a.overdue_at, status: 'completed' })
  })

  it('completing after the deadline marks it late and records the breach, even if the job never ran', async () => {
    const id = await newTask(); const mgr = await ctxFor(MGR); const emp = await ctxFor(EMP)
    await adminSql()`alter table tasks disable trigger tasks_lifecycle_before`
    await adminSql()`update tasks set due_at = now() - interval '2 hours' where id = ${id}`
    await adminSql()`alter table tasks enable trigger tasks_lifecycle_before`
    await tasks.submitTask(emp, id); await tasks.reviewTask(mgr, id, 'approved')
    const [t] = await adminSql()`select completed_late, overdue_at from tasks where id = ${id}`
    expect(t.completed_late).toBe(true); expect(t.overdue_at).toBeTruthy()
  })
})

describe('reminders', () => {
  const setDue = async (id: string, interval: string) => {
    await adminSql()`alter table tasks disable trigger tasks_lifecycle_before`
    await adminSql().unsafe(`update tasks set due_at = now() + interval '${interval}', due_date = (now() + interval '${interval}')::date where id = '${id}'`)
    await adminSql()`alter table tasks enable trigger tasks_lifecycle_before`
  }
  const notes = async (id: string, email: string) => adminSql()`select event_key, title from staff_notifications where subject_id = ${id} and user_id = ${await userId(email)} and event_key <> 'task_assigned'`

  it('one reminder at the closest passed step; repeat runs add nothing; a later step adds one', async () => {
    const id = await newTask()
    await setDue(id, '5 hours')
    await anonymous((tx) => tx`select app.task_reminders_tick()`); await anonymous((tx) => tx`select app.task_reminders_tick()`)
    let n = await notes(id, EMP)
    expect(n.length).toBe(1); expect(n[0].title).toContain('6 hour')
    await setDue(id, '50 minutes')
    await anonymous((tx) => tx`select app.task_reminders_tick()`)
    n = await notes(id, EMP)
    expect(n.map((x) => x.title).join()).toContain('1 hour')
  })

  it('overdue goes to the assignee and escalates to the manager once, respecting the company settings', async () => {
    const id = await newTask()
    await setDue(id, '-2 hours')
    await anonymous((tx) => tx`select app.task_reminders_tick()`); await anonymous((tx) => tx`select app.task_reminders_tick()`)
    expect((await notes(id, EMP)).map((x) => x.event_key)).toEqual(['task_overdue'])
    expect((await notes(id, MGR)).filter((x) => x.event_key === 'task_escalated').length).toBe(1)

    const md = await ctxFor('md@demo.test')
    await tasks.saveTaskReminderSettings(md, GRD, [60], false, false, false)
    const gid = await tasks.createTask(await ctxFor(GMGR), { orgId: GRD, title: `Quiet ${rand()}`, assignedTo: await userId('grd.counsellor@demo.test'), dueDate: future(2) })
    await setDue(gid, '-2 hours')
    await anonymous((tx) => tx`select app.task_reminders_tick()`)
    expect((await notes(gid, 'grd.counsellor@demo.test')).length).toBe(0)
    await refuses(tasks.saveTaskReminderSettings(await ctxFor(EMP), EDX, [60], true, true, true), 'forbidden')
    await adminSql()`delete from task_reminder_settings where org_id = ${GRD}`
  })

  it('only the system runs the reminder job', async () => {
    await expectDbError(as(MGR, (tx) => tx`select app.task_reminders_tick()`), '42501')
  })
})

describe('reports', () => {
  it('counts match the records, by person and department; only people who read all tasks; company isolated', async () => {
    const mgr = await ctxFor(MGR); const emp = await ctxFor(EMP)
    const before = (await tasks.taskReport(mgr, [EDX], {})).people.find((p) => p.user_id === emp.userId)!
    const a = await newTask(); const b = await newTask()
    await tasks.submitTask(emp, a); await tasks.reviewTask(mgr, a, 'approved')
    const r = await tasks.taskReport(mgr, [EDX], {})
    const row = r.people.find((p) => p.user_id === emp.userId)!
    expect(row.assigned - before.assigned).toBe(2)
    expect(row.completed - before.completed).toBe(1)
    expect(row.open - before.open).toBe(1)
    expect(r.totals.open).toBe(r.people.reduce((n, p) => n + p.open, 0))
    expect(r.departments.reduce((n, d) => n + d.open, 0)).toBe(r.totals.open)
    expect(b).toBeTruthy()
    await refuses(tasks.taskReport(emp, [EDX], {}), 'forbidden')
    await refuses(tasks.taskReport(await ctxFor(GMGR), [EDX], {}), 'forbidden')
    const [real] = await adminSql()`select count(*)::int as n from tasks where org_id = ${EDX} and status not in ('completed', 'cancelled') and assigned_to = ${emp.userId}`
    expect(row.open).toBe(real.n)
  })
})
