/** Phase 9: leads (company-specific, central review queue, duplicates flagged, conversion, Leadist import) and Refer a Friend. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous, db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as leads from '@/services/leads'
import * as students from '@/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string; let GRD: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const phone = () => `+91 98${rand()}${rand().slice(0, 3)}`
beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}
async function portalSession(studentId: string) {
  const token = `t-${rand()}-${Date.now()}`
  await adminSql()`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${token}, ${[studentId]}, ${studentId})`
  return token
}

describe('leads', () => {
  it('company-specific: an Edulinks counsellor cannot see or create GRADUATER leads; CEO only reads', async () => {
    const edx = await ctxFor('edx.counsellor@demo.test')
    const grdMgr = await ctxFor('grd.manager@demo.test')
    const id = await leads.createLead(grdMgr, { orgId: GRD, fullName: 'Grad Lead', phone: phone(), programme: 'bachelors', consent: 'yes' })
    expect(await leads.getLead(edx, id)).toBeNull()
    await expectServiceError(leads.createLead(edx, { orgId: GRD, fullName: 'X Lead', phone: phone(), consent: 'yes' }), 'forbidden')
    await expectServiceError(leads.createLead(edx, { orgId: EDX, fullName: 'No Consent', phone: phone() }), 'invalid')
    const mine = await leads.createLead(edx, { orgId: EDX, fullName: 'Edx Lead', phone: phone(), programme: 'mbbs', consent: 'yes' })
    const ceo = await ctxFor('ceo@demo.test')
    expect((await leads.getLead(ceo, mine))?.manage).toBe(false)
    await expect(as('ceo@demo.test', (tx) => tx`update leads set status = 'contacted' where id = ${mine}`)).resolves.toHaveLength(0)
    // a counsellor cannot move a lead to the other company
    await expectServiceError(leads.routeLead(edx, mine, GRD))
  })

  it('duplicates are flagged (lead or student with the same phone/email), reviewed, never merged', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const p = phone()
    const a = await leads.createLead(mgr, { orgId: EDX, fullName: 'Dup One', phone: p, consent: 'yes' })
    const b = await leads.createLead(mgr, { orgId: EDX, fullName: 'Dup Two', phone: p, consent: 'yes' })
    const lb = (await leads.getLead(mgr, b))!.lead
    expect(lb.duplicate_status).toBe('possible')
    expect(lb.duplicate_note).toMatch(/Dup One/)
    expect((await adminSql()`select count(*)::int as n from leads where id in (${a}, ${b})`)[0].n).toBe(2)
    await leads.reviewDuplicate(mgr, b, 'duplicate')
    expect((await leads.getLead(mgr, b))!.lead).toMatchObject({ duplicate_status: 'duplicate', status: 'invalid' })
    await expectServiceError(leads.reviewDuplicate(mgr, b, 'not_duplicate'), 'invalid')
  })

  it('closing needs a reason; conversion registers the student and admission letter confirms the lead', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const id = await leads.createLead(mgr, { orgId: EDX, fullName: 'Convert Lead', phone: phone(), email: `cl.${rand()}@example.test`, programme: 'mbbs', consent: 'yes' })
    await expectServiceError(leads.updateLeadWork(mgr, id, { status: 'not_interested' }), 'invalid')
    await expectServiceError(leads.updateLeadWork(mgr, id, { status: 'application_started' }), 'invalid')
    await leads.updateLeadWork(mgr, id, { status: 'interested', note: 'Called, wants MBBS in Bulgaria', noteKind: 'call', nextFollowupOn: '2030-01-01' })
    const r = await leads.convertLead(mgr, id)
    if (!r.ok) throw new Error('duplicate')
    const l = (await leads.getLead(mgr, id))!
    expect(l.lead).toMatchObject({ status: 'application_started', converted_student_id: r.id })
    expect(l.activities.map((x) => x.kind)).toEqual(expect.arrayContaining(['created', 'status', 'call', 'conversion']))
    await expectServiceError(leads.convertLead(mgr, id), 'invalid')
    await expectDbError(adminSql()`update leads set converted_student_id = null where id = ${id}`, '42501')
    await students.changeStage(mgr, r.id, { toStage: 'admission_letter', reason: 'test', force: true }).catch(() => null)
    await adminSql()`insert into student_stage_history (student_id, from_stage, to_stage, changed_by) values (${r.id}, 'lead', 'admission_letter', ${mgr.userId})`
    expect((await leads.getLead(mgr, id))!.lead.status).toBe('admission_confirmed')
  })

  it('Leadist CSV import: adds rows, skips already-imported ids, reports bad rows', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const ext = `LD-${rand()}`
    const csv = `Lead ID,Name,Mobile,Email,Course\n${ext},Imported One,${phone()},,MBBS\n,Bad Row,,,\n`
    const f = () => new File([csv], 'leadist.csv', { type: 'text/csv' })
    const r1 = await leads.importLeads(mgr, EDX, 'leadist', f())
    expect(r1).toMatchObject({ added: 1, skipped: 0 })
    expect(r1.errors).toHaveLength(1)
    const r2 = await leads.importLeads(mgr, EDX, 'leadist', f())
    expect(r2).toMatchObject({ added: 0, skipped: 1 })
    const [row] = await adminSql()`select source, programme from leads where external_ref = ${ext}`
    expect(row).toMatchObject({ source: 'leadist', programme: 'mbbs' })
  })
})

describe('refer a friend', () => {
  it('routes by programme, blocks self-referral, needs consent, and shows the referrer only progress', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const p = phone()
    const s = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Referrer Student', phone: p })
    if (!s.ok) throw new Error()
    const token = await portalSession(s.id)
    const [{ code }] = await anonymous((tx) => tx<{ code: string }[]>`select app.portal_referral_code(${token}) as code`)
    expect(code).toMatch(/^[A-Z2-9]{10}$/)
    const [{ again }] = await anonymous((tx) => tx<{ again: string }[]>`select app.portal_referral_code(${token}) as again`)
    expect(again).toBe(code)
    const submit = (body: Record<string, unknown>) => anonymous((tx) => tx`select app.portal_submit_referral(${token}, ${tx.json(body as never)}, '10.0.0.1')`)
    await expect(submit({ name: 'Myself', phone: p, programme: 'mbbs', consent: true })).rejects.toThrow(/refer yourself/)
    await expect(submit({ name: 'No Consent', phone: phone(), programme: 'mbbs', consent: false })).rejects.toThrow(/consent/)
    await submit({ name: 'Friend Medic', phone: phone(), programme: 'nursing', consent: true })
    await submit({ name: 'Friend Business', email: `fb.${rand()}@example.test`, programme: 'bachelors', consent: true })
    await submit({ name: 'Friend Unsure', phone: phone(), programme: 'not_sure', consent: true })
    const rows = await adminSql()`select l.full_name, o.code, l.source, l.consent from referrals r join leads l on l.id = r.lead_id left join organizations o on o.id = l.org_id
                                    where r.referrer_student_id = ${s.id} order by l.full_name`
    expect(rows.map((r) => [r.full_name, r.code])).toEqual([['Friend Business', 'GRD'], ['Friend Medic', 'EDX'], ['Friend Unsure', null]])
    expect(rows.every((r) => r.source === 'referral' && r.consent)).toBe(true)
    // the referrer sees first names and simplified progress only
    const [{ list }] = await anonymous((tx) => tx<{ list: Record<string, unknown>[] }[]>`select app.portal_referrals(${token}) as list`)
    expect(list).toHaveLength(3)
    expect(Object.keys(list[0]).sort()).toEqual(['created_at', 'name', 'status'])
    expect(list.map((x) => x.name)).toContain('Friend')
    // public link: no ids, only first name and company
    const [{ info }] = await anonymous((tx) => tx<{ info: Record<string, string> }[]>`select app.public_referral_info(${code}) as info`)
    expect(info).toEqual({ first_name: 'Referrer', company: 'Dr.Expert Edulinks' })
    await anonymous((tx) => tx`select app.public_submit_referral(${code}, ${tx.json({ name: 'Link Visitor', phone: phone(), programme: 'medical_pg', consent: true })}, '10.0.0.2')`)
    expect((await adminSql()`select channel from referrals where referrer_student_id = ${s.id} and channel = 'link'`)).toHaveLength(1)
    expect((await anonymous((tx) => tx<{ info: unknown }[]>`select app.public_referral_info('AAAAAAAAAA') as info`))[0].info).toBeNull()
    // the central queue is visible to reviewers (manager), not to a counsellor
    const unsure = (await adminSql()`select l.id from leads l join referrals r on r.lead_id = l.id where l.full_name = 'Friend Unsure' and r.referrer_student_id = ${s.id}`)[0].id
    expect(await leads.getLead(await ctxFor('edx.counsellor@demo.test'), unsure)).toBeNull()
    expect(await leads.getLead(mgr, unsure)).not.toBeNull()
    await leads.routeLead(mgr, unsure, EDX)
    expect((await leads.getLead(mgr, unsure))!.lead.org_id).toBe(EDX)
  })
})
