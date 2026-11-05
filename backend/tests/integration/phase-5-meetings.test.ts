/** Phase 5: core meetings and minutes. Private by default; decisions become ordinary tasks. Fictional data. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as meetings from '@/services/meetings'
import * as secure from '@/services/secure-files'
import * as tasks from '@/services/tasks'
import { adminSql, as, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string; let GRD: string
const MD = 'md@demo.test'; const EA = 'edx.counsellor@demo.test'; const ATT = 'edx.manager@demo.test'; const OUT = 'edx.counsellor2@demo.test'; const SA = 'admin@demo.test'; const GMGR = 'grd.manager@demo.test'
const SECRET = 'Fictional confidential discussion'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
const pdf = () => new File([new TextEncoder().encode(`%PDF-1.4\n% ${rand()}\n%%EOF`)], 'minutes.pdf', { type: 'application/pdf' })
async function refuses(p: Promise<unknown>, text?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (text) expect(`${(e as ServiceError).kind} ${(e as ServiceError).message}`).toContain(text); return }
  throw new Error('expected a refusal')
}
const make = async () => meetings.createMeeting(await ctxFor(MD), EDX, { title: `Core ${rand()}`, date: '2026-11-05', time: '10:00', agenda: 'Fictional agenda', noteTaker: await userId(EA), attendees: [await userId(ATT)] })
beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql().end() })

describe('privacy', () => {
  it('readable by creator, note taker and attendees; not by others, a system administrator or the other company', async () => {
    const id = await make()
    await meetings.saveMinutes(await ctxFor(EA), id, SECRET)
    for (const who of [MD, EA, ATT]) expect((await meetings.getMeeting(await ctxFor(who), id))?.minutes?.discussion_notes).toBe(SECRET)
    for (const who of [OUT, SA, GMGR]) expect(await meetings.getMeeting(await ctxFor(who), id)).toBeNull()
    for (const who of [OUT, SA, GMGR]) await expect(as(who, (tx) => tx`select id from meeting_minutes_versions where meeting_id = ${id}`)).resolves.toEqual([])
    await expectDbError(as(SA, (tx) => tx`insert into meetings (org_id, title, scheduled_at, created_by) values (${EDX}, 'x', now(), ${EDX})`), '42501')
    await expectDbError(as(ATT, (tx) => tx`update meeting_minutes set discussion_notes = 'x' where meeting_id = ${id}`), '42501')
  })

  it('the Core Team can read every meeting; membership is dynamic; removal ends access', async () => {
    const id = await make(); const md = await ctxFor(MD); const out = await ctxFor(OUT)
    expect(await meetings.getMeeting(out, id)).toBeNull()
    await refuses(meetings.setCoreTeamMember(out, EDX, out.userId, true), 'forbidden')
    await meetings.setCoreTeamMember(md, EDX, out.userId, true)
    expect(await meetings.getMeeting(out, id)).not.toBeNull()
    expect(await meetings.hasMeetingAccess(out)).toBe(true)
    await meetings.setCoreTeamMember(md, EDX, out.userId, false)
    expect(await meetings.getMeeting(out, id)).toBeNull()
    await refuses(meetings.setCoreTeamMember(md, EDX, await userId('grd.counsellor@demo.test'), true), 'not an active member')
    const [log] = await adminSql()`select count(*)::int as n from audit_logs where entity_type = 'core_team_members'`
    expect(log.n).toBeGreaterThanOrEqual(2)
  })

  it('audit entries never hold the private text', async () => {
    const id = await make()
    const ea = await ctxFor(EA)
    await meetings.saveMinutes(ea, id, SECRET)
    await meetings.addDecision(ea, id, `${SECRET} decision`)
    await meetings.addAction(ea, id, { description: `${SECRET} action`, responsible: ea.userId })
    const [{ n }] = await adminSql()`select count(*)::int as n from audit_logs where (after_data::text like ${'%' + SECRET + '%'} or before_data::text like ${'%' + SECRET + '%'})`
    expect(n).toBe(0)
    expect((await adminSql()`select count(*)::int as n from staff_notifications where title like ${'%' + SECRET + '%'}`)[0].n).toBe(0)
  })
})

describe('creating and minutes', () => {
  it('only holders of meetings.manage create; attendees must belong to the company; attendees and note taker are told', async () => {
    await refuses(meetings.createMeeting(await ctxFor(OUT), EDX, { title: 'No', date: '2026-11-05', time: '10:00' }), 'forbidden')
    await refuses(meetings.createMeeting(await ctxFor(MD), EDX, { title: '', date: 'bad', time: '10:00' }))
    await refuses(meetings.createMeeting(await ctxFor(MD), EDX, { title: 'Wrong people', date: '2026-11-05', time: '10:00', attendees: [await userId('grd.counsellor@demo.test')] }), 'active member')
    const id = await make()
    const [a] = await adminSql()`select count(*)::int as n from staff_notifications where subject_id = ${id} and event_key = 'meeting_invited' and user_id = ${await userId(ATT)}`
    const [b] = await adminSql()`select count(*)::int as n from staff_notifications where subject_id = ${id} and event_key = 'meeting_note_taker' and user_id = ${await userId(EA)}`
    expect([a.n, b.n]).toEqual([1, 1])
  })

  it('every save keeps a version with who and why; a change needs a reason; attendees cannot edit', async () => {
    const id = await make(); const ea = await ctxFor(EA)
    expect(await meetings.saveMinutes(ea, id, 'First version')).toBe(1)
    await refuses(meetings.saveMinutes(ea, id, 'Second version'), 'reason')
    expect(await meetings.saveMinutes(ea, id, 'Second version', 'Fictional correction')).toBe(2)
    const d = (await meetings.getMeeting(ea, id))!
    expect(d.minutes).toMatchObject({ discussion_notes: 'Second version', version: 2 })
    expect(d.versions.map((v) => [v.version, v.discussion_notes, v.edit_reason])).toEqual([[2, 'Second version', 'Fictional correction'], [1, 'First version', null]])
    expect(d.meeting.status).toBe('held')
    await refuses(meetings.saveMinutes(await ctxFor(ATT), id, 'Attendee change', 'Not allowed'), 'forbidden')
    const [n] = await adminSql()`select count(*)::int as n from staff_notifications where subject_id = ${id} and event_key = 'meeting_minutes_ready'`
    expect(n.n).toBe(1)
    await meetings.cancelMeeting(await ctxFor(MD), id)
    await refuses(meetings.saveMinutes(ea, id, 'After cancel', 'Too late'), 'cancelled')
  })

  it('attachments follow the meeting', async () => {
    const id = await make(); const ea = await ctxFor(EA)
    const f = await secure.uploadSecureFile(ea, 'meeting', id, pdf())
    expect(await secure.openSecureFile(await ctxFor(ATT), f)).toBeTruthy()
    expect(await secure.openSecureFile(await ctxFor(OUT), f)).toBeNull()
    expect(await secure.openSecureFile(await ctxFor(SA), f)).toBeNull()
    await refuses(secure.uploadSecureFile(await ctxFor(ATT), 'meeting', id, pdf()), 'forbidden')
  })

  it('the daily job tells the note taker when minutes are missing; only the system runs it', async () => {
    const id = await meetings.createMeeting(await ctxFor(MD), EDX, { title: `Old ${rand()}`, date: '2026-11-05', time: '10:00', noteTaker: await userId(EA) })
    await adminSql()`update meetings set scheduled_at = now() - interval '1 day' where id = ${id}`
    await anonymous((tx) => tx`select app.meetings_daily()`); await anonymous((tx) => tx`select app.meetings_daily()`)
    const [n] = await adminSql()`select count(*)::int as n from staff_notifications where subject_id = ${id} and event_key = 'meeting_minutes_due'`
    expect(n.n).toBe(1)
    await expectDbError(as(MD, (tx) => tx`select app.meetings_daily()`), '42501')
  })
})

describe('decision to task', () => {
  it('an action point becomes one ordinary task, keeping the meeting link; the assignee works it as usual and cannot read the meeting', async () => {
    const id = await make(); const ea = await ctxFor(EA); const out = await ctxFor(OUT)
    const dec = await meetings.addDecision(ea, id, 'Fictional decision')
    const act = await meetings.addAction(ea, id, { decisionId: dec, description: 'Fictional action', responsible: out.userId, date: '2026-12-01', time: '17:00', priority: 'high' })
    await refuses(meetings.actionToTask(await ctxFor(ATT), act), 'forbidden')
    const taskId = await meetings.actionToTask(ea, act)
    await refuses(meetings.actionToTask(ea, act), 'already has a task')
    const [t] = await adminSql()`select * from tasks where id = ${taskId}`
    expect(t).toMatchObject({ assigned_to: out.userId, priority: 'high', requires_review: true, org_id: EDX, created_by: ea.userId })
    expect(t.due_at).toBeTruthy()
    const seen = await tasks.getTask(out, taskId)
    expect(seen?.task.title).toBe('Fictional action')
    expect(seen?.task.meeting_id).toBeNull() // no route into a private meeting
    expect((await tasks.getTask(ea, taskId))?.task.meeting_id).toBe(id)
    expect((await meetings.getMeeting(ea, id))?.actions[0]).toMatchObject({ task_id: taskId, task_status: 'not_started' })
    const [n] = await adminSql()`select count(*)::int as n from staff_notifications where subject_id = ${taskId} and event_key = 'task_assigned' and user_id = ${out.userId}`
    expect(n.n).toBe(1)
  })

  it('needs someone responsible; a decision of another meeting cannot be linked; the responsible person must belong to the company', async () => {
    const id = await make(); const other = await make(); const ea = await ctxFor(EA)
    const a = await meetings.addAction(ea, id, { description: 'No owner yet' })
    await refuses(meetings.actionToTask(ea, a), 'responsible')
    const dec = await meetings.addDecision(ea, other, 'In another meeting')
    await refuses(meetings.addAction(ea, id, { description: 'Bad link', decisionId: dec }), 'another meeting')
    await refuses(meetings.addAction(ea, id, { description: 'Wrong company', responsible: await userId('grd.counsellor@demo.test') }), 'active member')
    expect(GRD).toBeTruthy()
  })
})
