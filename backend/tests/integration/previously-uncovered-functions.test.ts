/**
 * Eleven privileged functions the app calls that no other Vitest test exercised (Stage A and B review, Nov 2026).
 * Each one runs as erp_app, the way the app calls it. All data is fictional and every change is undone.
 * A random id reaching a function's own "not found" check still proves erp_app may execute it.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { anonymous, db } from '@/lib/db'
import { adminSql, as, expectDbError, studentWhere } from '../support/helpers'

const MD = 'md@demo.test'
const COUNSELLOR = 'edx.counsellor@demo.test'
afterAll(async () => { await adminSql().end(); await db().end() })

describe('student portal, signed-in session', () => {
  it('portal_session, portal_choices, portal_choose and portal_logout work on a real session', async () => {
    const student = await studentWhere(`s.status = 'active' and s.archived_at is null`)
    const hash = `test-${randomUUID()}`
    await adminSql()`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${hash}, ${[student.id]}, ${student.id})`

    const [s] = await anonymous((tx) => tx<{ student_ids: string[]; active_student_id: string }[]>`select * from app.portal_session(${hash})`)
    expect(s.active_student_id).toBe(student.id)
    const choices = await anonymous((tx) => tx<{ student_id: string }[]>`select * from app.portal_choices(${hash})`)
    expect(choices.map((c) => c.student_id)).toEqual([student.id])
    const [chosen] = await anonymous((tx) => tx<{ ok: boolean }[]>`select app.portal_choose(${hash}, ${student.id}) as ok`)
    expect(chosen.ok).toBe(true)
    const [other] = await anonymous((tx) => tx<{ ok: boolean | null }[]>`select app.portal_choose(${hash}, ${randomUUID()}) as ok`)
    expect(other.ok).toBeNull()

    await anonymous((tx) => tx`select app.portal_logout(${hash})`)
    expect(await anonymous((tx) => tx`select * from app.portal_session(${hash})`)).toHaveLength(0)
    await adminSql()`delete from auth_private.portal_sessions where token_hash = ${hash}`
  })

  it('an unknown portal session returns nothing', async () => {
    expect(await anonymous((tx) => tx`select * from app.portal_session(${'no-such-session'})`)).toHaveLength(0)
    expect(await anonymous((tx) => tx`select * from app.portal_choices(${'no-such-session'})`)).toHaveLength(0)
  })

  it('public_countries answers without a signed-in user', async () => {
    const rows = await anonymous((tx) => tx<{ id: string; name: string }[]>`select * from app.public_countries()`)
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('staff functions', () => {
  it('mfa_my_status reports on the signed-in user', async () => {
    const [s] = await as(MD, (tx) => tx<{ enabled: boolean }[]>`select * from app.mfa_my_status()`)
    expect(typeof s.enabled).toBe('boolean')
  })

  it('set_academic_check works for the MD, refuses a counsellor and leaves the value as it was', async () => {
    const [st] = await adminSql()<{ key: string; academic_check: string }[]>`select key, academic_check from stages where kind = 'normal' order by sort_order limit 1`
    await as(MD, (tx) => tx`select app.set_academic_check(${st.key}, ${st.academic_check})`)
    await expectDbError(as(COUNSELLOR, (tx) => tx`select app.set_academic_check(${st.key}, ${'block'})`), '42501')
    const [after] = await adminSql()<{ academic_check: string }[]>`select academic_check from stages where key = ${st.key}`
    expect(after.academic_check).toBe(st.academic_check)
  })

  it('set_contact_required_stage works for the MD, refuses a counsellor and leaves the value as it was', async () => {
    const [cur] = await adminSql()<{ key: string | null }[]>`select (select key from stages where requires_complete_contact limit 1) as key`
    await as(MD, (tx) => tx`select app.set_contact_required_stage(${cur.key})`)
    await expectDbError(as(COUNSELLOR, (tx) => tx`select app.set_contact_required_stage(${null})`), '42501')
    const [after] = await adminSql()<{ key: string | null }[]>`select (select key from stages where requires_complete_contact limit 1) as key`
    expect(after.key).toBe(cur.key)
  })

  it('retire_one_and_same_template runs for the MD and refuses a counsellor', async () => {
    await as(MD, (tx) => tx`select app.retire_one_and_same_template(${randomUUID()})`)
    await expectDbError(as(COUNSELLOR, (tx) => tx`select app.retire_one_and_same_template(${randomUUID()})`), '42501')
  })

  it('cancel_attestation reaches its own not-found check', async () => {
    await expectDbError(as(MD, (tx) => tx`select app.cancel_attestation(${randomUUID()}, ${'fictional reason'})`), 'P0002')
  })

  it('record_courier_dispatch reaches its own not-found check', async () => {
    await expectDbError(as(MD, (tx) => tx`select app.record_courier_dispatch(${randomUUID()}, ${'Fictional Courier'}, ${'T-1'}, ${null}, ${null})`), 'P0002')
  })
})
