/** Business change (Nov 2026): country-wise academic requirements are ADVISORY notices with acknowledgement — never blocking. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/server/db'
import { ServiceError } from '@/server/errors'
import * as ac from '@/server/services/academic'
import * as rq from '@/server/services/requirements'
import * as students from '@/server/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const country = async (code: string) => (await adminSql()`select id from countries where code = ${code}`)[0].id as string
beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}
async function newStudent(dest: string) {
  const ctx = await ctxFor('edx.manager@demo.test')
  const r = await students.createStudent(ctx, { originatingOrgId: EDX, fullName: 'Advisory Test Student', phone: `+91 90091 ${rand()}`, phone2: `+91 90092 ${rand()}`,
    email: `adv.${rand()}@example.test`, passportNumber: `AV${rand()}`, passportExpiry: '2033-01-01', destinationCountryId: await country(dest) })
  if (!r.ok) throw new Error('duplicate')
  return { ctx, id: r.id }
}
async function addPlusTwo(ctx: Awaited<ReturnType<typeof ctxFor>>, id: string, m: Record<string, number>) {
  await ac.saveRecord(ctx, id, null, { kind: 'plus_two', gradingSystem: 'marks', totalMarks: String(Object.keys(m).length * 100) },
    Object.entries(m).map(([key, v]) => ({ key, name: key, max: '100', obtained: String(v) })))
}

describe('advisory country-wise requirements', () => {
  it('1, 6, 9, 10: Bulgaria notice shows; meeting marks give an informational status; acknowledgement is recorded; progression is possible', async () => {
    const { ctx, id } = await newStudent('BG')
    await addPlusTwo(ctx, id, { chemistry: 70, biology: 75, physics: 66, english: 80 })
    const [a] = await rq.studentAdvisories(ctx, id)
    expect(a).toMatchObject({ title: 'BULGARIA – IMPORTANT ACADEMIC REQUIREMENTS', academic_status: 'meets', requires_acknowledgement: true, acknowledged_at: null })
    expect(a.items.map((i) => i.result)).toEqual(['ok', 'ok', 'ok', 'ok'])
    await rq.acknowledgeAdvisory(ctx, id, a.notice_id)
    const [b] = await rq.studentAdvisories(ctx, id)
    expect(b.acknowledged_by).toContain('Rahul')
    const [ack] = await adminSql()`select academic_status, task_id, jsonb_array_length(evaluation) as n from advisory_acknowledgements where student_id = ${id}`
    expect(ack).toEqual({ academic_status: 'meets', task_id: null, n: 4 })
    await students.changeStage(ctx, id, { toStage: 'registration' })
    const w = await students.changeStage(ctx, id, { toStage: 'university_application' })
    if (!w.ok) expect(w.warnings.join(' ')).not.toMatch(/BULGARIA/) // acknowledged and met: no academic reminder (other reminders may remain)
    expect(await students.changeStage(ctx, id, { toStage: 'university_application', acknowledge: 'yes' })).toEqual({ ok: true })
  })

  it('7, 8, 10: below-threshold and missing marks give warnings and a follow-up task — never a block', async () => {
    const below = await newStudent('BG')
    await addPlusTwo(below.ctx, below.id, { chemistry: 50, biology: 75, physics: 66, english: 80 })
    const [a] = await rq.studentAdvisories(below.ctx, below.id)
    expect(a.academic_status).toBe('below')
    expect(a.items.find((i) => i.subject_key === 'chemistry')).toMatchObject({ result: 'below', actual: 50 })
    await rq.acknowledgeAdvisory(below.ctx, below.id, a.notice_id)
    const tasks = await adminSql()`select title from tasks where student_id = ${below.id} and source_key like 'adv:%'`
    expect(tasks[0].title).toMatch(/Academic verification/)
    await students.changeStage(below.ctx, below.id, { toStage: 'registration' })
    const w = await students.changeStage(below.ctx, below.id, { toStage: 'university_application' })
    expect(w.ok).toBe(false) // a reminder to acknowledge at the stage change …
    if (!w.ok) expect(w.warnings.join(' ')).toMatch(/below the configured requirement \(advisory\)/)
    expect(await students.changeStage(below.ctx, below.id, { toStage: 'university_application', acknowledge: 'yes' })).toEqual({ ok: true }) // … not a block

    const missing = await newStudent('BG')
    const [m] = await rq.studentAdvisories(missing.ctx, missing.id)
    expect(m.academic_status).toBe('missing')
    await students.changeStage(missing.ctx, missing.id, { toStage: 'registration' })
    expect(await students.changeStage(missing.ctx, missing.id, { toStage: 'university_application', acknowledge: 'yes' })).toEqual({ ok: true })
  })

  it('2, 3, 12: Egypt shows its own requirements once configured; a country without configuration shows nothing', async () => {
    const admin = await ctxFor('admin@demo.test')
    const eg = await newStudent('EG')
    expect((await rq.studentAdvisories(eg.ctx, eg.id)).filter((x) => x.country === 'Egypt')).toHaveLength(0) // nothing invented
    const ge = await newStudent('GE')
    expect(await rq.studentAdvisories(ge.ctx, ge.id)).toHaveLength(0)
    await rq.saveRequirement(admin, null, { destinationCountryId: await country('EG'), category: 'academic_marks', displayType: 'mandatory_notice', priority: 'high',
      title: `EGYPT – TEST REQUIREMENTS ${rand()}`, message: 'Test-only requirement for Egypt.', requiresAcknowledgement: 'yes' },
      [{ record_kind: 'plus_two', subject_key: 'biology', subject_name: 'Biology', min_percentage: '50' }])
    const [e] = (await rq.studentAdvisories(eg.ctx, eg.id)).filter((x) => x.country === 'Egypt')
    expect(e).toMatchObject({ display_type: 'mandatory_notice', academic_status: 'missing' })
    expect(e.items).toHaveLength(1)
    await expectServiceError(rq.saveRequirement(await ctxFor('edx.manager@demo.test'), null, { destinationCountryId: await country('EG'), category: 'general', displayType: 'additional_point', priority: 'normal', title: 'Nope', message: 'Nope' }, []), 'forbidden')
  })

  it('4, 5, 11: edits create versions with history and reason; earlier acknowledgements keep their version; deactivation hides the notice', async () => {
    const admin = await ctxFor('admin@demo.test')
    const group = await rq.saveRequirement(admin, null, { destinationCountryId: await country('UZ'), category: 'academic_marks', displayType: 'important_warning', priority: 'high',
      title: `UZBEKISTAN – TEST ${rand()}`, message: 'Test requirement.', requiresAcknowledgement: 'yes' },
      [{ record_kind: 'plus_two', subject_key: 'chemistry', subject_name: 'Chemistry', min_percentage: '55' }])
    const s = await newStudent('UZ')
    const [v1] = (await rq.studentAdvisories(s.ctx, s.id)).filter((x) => x.notice_group_id === group)
    await rq.acknowledgeAdvisory(s.ctx, s.id, v1.notice_id)
    await expectServiceError(rq.saveRequirement(admin, group, { destinationCountryId: await country('UZ'), category: 'academic_marks', displayType: 'important_warning', priority: 'high', title: 'X title', message: 'Y msg' },
      [{ record_kind: 'plus_two', subject_key: 'chemistry', subject_name: 'Chemistry', min_percentage: '65' }]), 'invalid') // reason required
    await rq.saveRequirement(admin, group, { destinationCountryId: await country('UZ'), category: 'academic_marks', displayType: 'important_warning', priority: 'high',
      title: v1.title, message: 'Test requirement (raised).', requiresAcknowledgement: 'yes' },
      [{ record_kind: 'plus_two', subject_key: 'chemistry', subject_name: 'Chemistry', min_percentage: '65' }], 'University raised the requirement (test)')
    const r = (await rq.getRequirement(admin, group))!
    expect(r.versions.map((v) => [v.version, v.status])).toEqual([[2, 'active'], [1, 'superseded']])
    const edited = r.events.find((e) => e.action === 'edited')!
    expect(edited.reason).toMatch(/raised/)
    expect(JSON.stringify(edited.previous)).toContain('55')
    expect(JSON.stringify(edited.current)).toContain('65')
    // the earlier acknowledgement still points at version 1; version 2 needs a new acknowledgement
    const [old] = await adminSql()`select n.version from advisory_acknowledgements a join advisory_notices n on n.id = a.notice_id where a.student_id = ${s.id}`
    expect(old.version).toBe(1)
    const [v2] = (await rq.studentAdvisories(s.ctx, s.id)).filter((x) => x.notice_group_id === group)
    expect(v2).toMatchObject({ version: 2, acknowledged_at: null, earlier_acknowledgement: true })
    // versions cannot be overwritten directly
    await expectDbError(adminSql()`update advisory_notices set title = 'hacked' where notice_group_id = ${group}`, '42501')
    await expectDbError(as('admin@demo.test', (tx) => tx`update advisory_notices set title = 'hacked' where notice_group_id = ${group}`), '42501')
    // deactivate (reason required) → no longer shown
    await expectServiceError(rq.setRequirementStatus(admin, group, false, ''), 'invalid')
    await rq.setRequirementStatus(admin, group, false, 'Paused (test)')
    expect((await rq.studentAdvisories(s.ctx, s.id)).filter((x) => x.notice_group_id === group)).toHaveLength(0)
    await rq.setRequirementStatus(admin, group, true, 'Resumed (test)')
    expect((await rq.studentAdvisories(s.ctx, s.id)).filter((x) => x.notice_group_id === group)).toHaveLength(1)
    await rq.setRequirementStatus(admin, group, false, 'Clean up (test)')
  })

  it('acknowledgement needs permission and does not leak across companies', async () => {
    const s = await newStudent('BG')
    const [a] = await rq.studentAdvisories(s.ctx, s.id)
    await expectServiceError(rq.acknowledgeAdvisory(await ctxFor('ceo@demo.test'), s.id, a.notice_id))
    expect(await rq.studentAdvisories(await ctxFor('grd.manager@demo.test'), s.id)).toHaveLength(0)
  })
})
