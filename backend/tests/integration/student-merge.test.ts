/** Student merges keep money, preferences, tickets and pre-admission links right (audit findings BC-03 and BC-04). Fictional data. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous, db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as dvr from '@/services/dvr'
import * as payments from '@/services/payments'
import * as pref from '@/services/preferences'
import * as students from '@/services/students'
import * as tickets from '@/services/tickets'
import { adminSql, ctxFor, orgId, userId } from '../support/helpers'

let EDX: string; let GRD: string; let SVC_EDX: string; let SVC_GRD: string; let BG: string; let RU: string; let BG_UNI: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const MD = 'md@demo.test'; const FIN = 'edx.finance@demo.test'; const MGR = 'edx.manager@demo.test'

beforeAll(async () => {
  EDX = await orgId('EDX'); GRD = await orgId('GRD')
  const sql = adminSql()
  SVC_EDX = (await sql`select id from fee_categories where org_id = ${EDX} and kind = 'service' order by name limit 1`)[0].id
  SVC_GRD = (await sql`select id from fee_categories where org_id = ${GRD} and kind = 'service' order by name limit 1`)[0].id
  BG = (await sql`select id from countries where code = 'BG'`)[0].id
  RU = (await sql`select id from countries where is_active and id <> ${BG} order by code limit 1`)[0].id
  BG_UNI = (await sql`select id from universities where country_id = ${BG} and is_active limit 1`)[0].id
})
afterAll(async () => { await adminSql().end(); await db().end() })

async function newStudent(org = EDX, over: Record<string, unknown> = {}) {
  const ctx = await ctxFor(org === EDX ? MGR : 'grd.manager@demo.test')
  const r = await students.createStudent(ctx, { originatingOrgId: org, fullName: `Merge Fictional ${rand()}`, phone: `+91 90093 ${rand()}`, ...over })
  if (!r.ok) throw new Error('student not created')
  return r.id
}
const codeOf = async (id: string) => (await adminSql()`select student_code from students where id = ${id}`)[0].student_code as string
const merge = async (keep: string, drop: string, reason = 'Fictional duplicate') => students.mergeStudents(await ctxFor(MD), keep, await codeOf(drop), reason)

async function charge(sid: string, amount: string, due: number | null, o: { org?: string; currency?: string; rate?: string } = {}) {
  const org = o.org ?? EDX
  const fin = await ctxFor(org === EDX ? FIN : 'grd.finance@demo.test')
  const id = await payments.recordEntry(fin, sid, { orgId: org, feeCategoryId: org === EDX ? SVC_EDX : SVC_GRD, entryDate: day(-30), entryType: 'charge', amount, currency: o.currency ?? 'INR', ...(o.rate ? { exchangeRate: o.rate } : {}) })
  if (due !== null) await payments.setDueDate(fin, id, { dueDate: day(due) })
  return id
}
async function receipt(sid: string, amount: string, o: { org?: string; currency?: string; rate?: string } = {}) {
  const org = o.org ?? EDX
  const fin = await ctxFor(org === EDX ? FIN : 'grd.finance@demo.test')
  const id = await payments.recordEntry(fin, sid, { orgId: org, feeCategoryId: org === EDX ? SVC_EDX : SVC_GRD, entryDate: day(-1), entryType: 'receipt', amount, currency: o.currency ?? 'INR', method: 'bank_transfer', referenceNumber: `R${rand()}${rand()}`, ...(o.rate ? { exchangeRate: o.rate } : {}) })
  await payments.verifyEntry(await ctxFor(MD), id, 'verified')
  return id
}
const unpaid = async (entry: string) => (await adminSql()`select unpaid::text as u from payment_due_status where entry_id = ${entry}`)[0]?.u as string | undefined
const dueOwner = async (entry: string) => (await adminSql()`select student_id from payment_due_dates where entry_id = ${entry}`)[0].student_id as string
const balances = async (sid: string) => (await adminSql()`select org_id, ledger, currency, amount_due::text, amount_received::text, outstanding::text from student_balances where student_id = ${sid} order by org_id, ledger, currency`)
/** Every column of each entry except the student it points at, so a merge can be shown to change nothing else. */
const ledgerRows = async (ids: string[]) => adminSql()`select md5(string_agg((to_jsonb(e) - 'student_id')::text, ',' order by e.id)) as m, count(*)::int as n from payment_entries e where e.student_id = any(${ids}::uuid[])`
const remind = () => anonymous((tx) => tx<{ n: number }[]>`select app.payment_due_reminders() as n`).then(([r]) => r.n)
const reminders = (entry: string) => adminSql()`select n.event_key, n.href, u.email from staff_notifications n join user_profiles u on u.id = n.user_id where n.dedupe_key like ${`payment_%:${entry}:%`}`

async function refuses(p: Promise<unknown>, text?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (text) expect((e as ServiceError).message).toContain(text); return }
  throw new Error('expected a refusal')
}

describe('payments across a merge (BC-03)', () => {
  it('a fully paid charge stays fully paid; it moves to the surviving record and raises no reminder', async () => {
    const keep = await newStudent(); const drop = await newStudent()
    const c = await charge(drop, '50000', -2)
    await receipt(drop, '50000')
    expect(await unpaid(c)).toBe('0.00')
    const before = await ledgerRows([keep, drop])
    await merge(keep, drop)
    expect(await unpaid(c)).toBe('0.00')
    expect(await dueOwner(c)).toBe(keep)
    expect(await ledgerRows([keep, drop])).toEqual(before)
    const fin = await ctxFor(FIN)
    expect((await payments.studentDueDates(fin, keep)).map((d) => [d.entry_id, d.unpaid])).toEqual([[c, '0.00']])
    expect(await payments.studentDueDates(fin, drop)).toEqual([])
    await remind()
    expect(await reminders(c)).toEqual([])
  })

  it('money on one record is not shifted onto the other record\'s older unpaid charge', async () => {
    const keep = await newStudent(); const drop = await newStudent()
    const older = await charge(keep, '1000', -20)
    const paid = await charge(drop, '50000', -2)
    await receipt(drop, '50000')
    await merge(keep, drop)
    expect(await unpaid(paid)).toBe('0.00')
    expect(await unpaid(older)).toBe('1000.00')
    const [b] = await balances(keep)
    expect(b).toMatchObject({ amount_due: '51000.00', amount_received: '50000.00', outstanding: '1000.00' })
  })

  it('partly paid, several payments against one charge, and unpaid charges keep their exact amounts, and the totals match the balance', async () => {
    const keep = await newStudent(); const drop = await newStudent()
    const part = await charge(keep, '10000', -10)
    await receipt(keep, '2500'); await receipt(keep, '1500')
    const instalments = await charge(drop, '9000', -8)
    await receipt(drop, '3000'); await receipt(drop, '3000'); await receipt(drop, '3000')
    const open = await charge(drop, '700', -1)
    const before = [await unpaid(part), await unpaid(instalments), await unpaid(open)]
    expect(before).toEqual(['6000.00', '0.00', '700.00'])
    const ledger = await ledgerRows([keep, drop])
    await merge(keep, drop)
    expect([await unpaid(part), await unpaid(instalments), await unpaid(open)]).toEqual(before)
    expect(await ledgerRows([keep, drop])).toEqual(ledger)
    const [b] = await balances(keep)
    expect(b).toMatchObject({ amount_due: '19700.00', amount_received: '13000.00', outstanding: '6700.00' })
    const shown = await payments.studentDueDates(await ctxFor(FIN), keep)
    expect(shown.reduce((sum, d) => sum + Number(d.unpaid), 0)).toBe(6700) // what the due dates show unpaid is exactly what is outstanding
  })

  it('currencies are kept apart', async () => {
    const keep = await newStudent(); const drop = await newStudent()
    const inr = await charge(keep, '1000', -5)
    const usd = await charge(drop, '500', -5, { currency: 'USD', rate: '85' })
    await receipt(drop, '500', { currency: 'USD', rate: '85' })
    const inr2 = await charge(drop, '2000', -3)
    await merge(keep, drop)
    expect(await unpaid(usd)).toBe('0.00')
    expect(await unpaid(inr)).toBe('1000.00')
    expect(await unpaid(inr2)).toBe('2000.00')
    expect((await balances(keep)).map((b) => [b.currency, b.outstanding])).toEqual(expect.arrayContaining([['INR', '3000.00'], ['USD', '0.00']]))
  })

  it('reminders: one reminder before the merge is not repeated after it; a new one links to the surviving record; a settled charge gets none', async () => {
    const keep = await newStudent(); const drop = await newStudent()
    const open = await charge(drop, '4000', -2)
    await remind()
    const first = await reminders(open)
    expect(first.some((r) => r.email === FIN && r.event_key === 'payment_overdue')).toBe(true)
    const paid = await charge(drop, '3000', 2)
    const paid2 = await charge(keep, '100', -1)
    await receipt(keep, '100')
    await merge(keep, drop)
    await remind()
    expect((await reminders(open)).length).toBe(first.length) // the same charge and date: not repeated
    expect((await reminders(paid2))).toEqual([])
    const soon = await reminders(paid)
    expect(soon.length).toBeGreaterThan(0)
    expect(soon.every((r) => r.href === `/students/${keep}`)).toBe(true)
  })

  it('money received after a merge settles the earliest open charge; a later reversal never hides what is owed', async () => {
    const keep = await newStudent(); const drop = await newStudent()
    const a = await charge(keep, '1000', -20)
    const b = await charge(drop, '5000', -10)
    const r = await receipt(drop, '5000')
    await merge(keep, drop)
    expect([await unpaid(a), await unpaid(b)]).toEqual(['1000.00', '0.00'])
    const r2 = await receipt(keep, '400')
    expect([await unpaid(a), await unpaid(b)]).toEqual(['600.00', '0.00'])
    await payments.reverseEntry(await ctxFor(FIN), r, 'Fictional bank return')
    const [rev] = await adminSql()`select id from payment_entries where reverses_entry_id = ${r}`
    await payments.verifyEntry(await ctxFor(MD), rev.id, 'verified')
    // the receipt behind the recorded amount is gone, so the view goes back to earliest first, and the total is right
    expect([await unpaid(a), await unpaid(b)]).toEqual(['600.00', '5000.00'])
    const [bal] = await balances(keep)
    expect(bal.outstanding).toBe('5600.00')
    expect(r2).toBeTruthy()
  })

  it('a chain of merges keeps the same figures', async () => {
    const a = await newStudent(); const b = await newStudent(); const c = await newStudent()
    const ca = await charge(a, '100', -9); const cb = await charge(b, '200', -8); const cc = await charge(c, '300', -7)
    await receipt(b, '200'); await receipt(c, '50')
    await merge(b, c)
    await merge(a, b)
    expect([await unpaid(ca), await unpaid(cb), await unpaid(cc)]).toEqual(['100.00', '0.00', '250.00'])
    expect([await dueOwner(ca), await dueOwner(cb), await dueOwner(cc)]).toEqual([a, a, a])
  })

  it('across companies: each ledger stays with its company, and each company sees only its own money', async () => {
    const keep = await newStudent(EDX); const drop = await newStudent(GRD)
    const e = await charge(keep, '1000', -5)
    const g = await charge(drop, '2000', -5, { org: GRD })
    await receipt(drop, '2000', { org: GRD })
    await merge(keep, drop)
    expect((await adminSql()`select org_id from payment_due_dates where entry_id = ${g}`)[0].org_id).toBe(GRD)
    expect(await unpaid(e)).toBe('1000.00')
    expect(await unpaid(g)).toBe('0.00')
    const seenBy = async (email: string) => (await payments.studentDueDates(await ctxFor(email), keep)).map((d) => d.entry_id)
    expect(await seenBy(FIN)).toEqual([e])
    expect(await seenBy('grd.finance@demo.test')).toEqual([g])
  })
})

describe('preferences across a merge (BC-04)', () => {
  const held = async (sid: string) => (await adminSql()`select rank, country_id, university_id from student_preferences where student_id = ${sid} order by rank`)
  const history = async (sid: string) => (await adminSql()`select action, rank, country, note from student_preference_history where student_id = ${sid} order by changed_at, id`)

  it('moves a preference to its own rank or the free one, with its history', async () => {
    const keep = await newStudent(); const drop = await newStudent(); const m = await ctxFor(MGR)
    await pref.savePreference(m, keep, 2, { countryId: BG, universityId: BG_UNI })
    await pref.savePreference(m, drop, 2, { countryId: RU })
    await merge(keep, drop)
    expect(await held(keep)).toEqual([expect.objectContaining({ rank: 2, country_id: BG }), expect.objectContaining({ rank: 3, country_id: RU })])
    expect(await held(drop)).toEqual([])
    const h = await history(keep)
    expect(h.filter((x) => x.action === 'saved').length).toBe(2) // the merged record's own history came across
    expect(h.find((x) => x.action === 'merged_in')).toMatchObject({ rank: 3, note: `From merged record ${await codeOf(drop)}` })
    expect(await history(drop)).toEqual([])
    expect((await pref.studentPreferences(m, keep))!.others.length).toBe(2)
  })

  it('a preference already held is not duplicated, and the details stay in the history', async () => {
    const keep = await newStudent(); const drop = await newStudent(); const m = await ctxFor(MGR)
    await pref.savePreference(m, keep, 2, { countryId: BG, universityId: BG_UNI })
    await pref.savePreference(m, drop, 3, { countryId: BG, universityId: BG_UNI })
    await merge(keep, drop)
    expect(await held(keep)).toEqual([expect.objectContaining({ rank: 2, country_id: BG, university_id: BG_UNI })])
    expect((await history(keep)).find((x) => x.action === 'merged_duplicate')).toMatchObject({ rank: 3 })
    expect(await held(drop)).toEqual([])
  })

  it('a preference equal to the surviving record\'s primary choice is not duplicated', async () => {
    const keep = await newStudent(EDX, { destinationCountryId: BG, preferredUniversityId: BG_UNI }); const drop = await newStudent(); const m = await ctxFor(MGR)
    await pref.savePreference(m, drop, 2, { countryId: BG, universityId: BG_UNI })
    await merge(keep, drop)
    expect(await held(keep)).toEqual([])
    expect((await history(keep)).map((x) => x.action)).toContain('merged_duplicate')
  })

  it('stops, and says why, when different preferences cannot all fit. Nothing changes; clearing one lets it through', async () => {
    const keep = await newStudent(); const drop = await newStudent(); const m = await ctxFor(MGR)
    const [other] = await adminSql()`select id from countries where is_active and id not in (${BG}, ${RU}) order by code limit 1`
    await pref.savePreference(m, keep, 2, { countryId: BG, universityId: BG_UNI })
    await pref.savePreference(m, keep, 3, { countryId: RU })
    await pref.savePreference(m, drop, 2, { countryId: other.id })
    const c = await charge(drop, '100', -1)
    await refuses(merge(keep, drop), 'Cannot merge: both records have different secondary and tertiary preferences')
    expect((await adminSql()`select status from students where id = ${drop}`)[0].status).not.toBe('merged')
    expect((await held(drop)).length).toBe(1)
    expect(await dueOwner(c)).toBe(drop)
    await pref.clearPreference(m, keep, 3)
    await merge(keep, drop)
    expect((await held(keep)).map((p) => p.country_id)).toEqual([BG, other.id])
  })
})

describe('tickets across a merge (BC-04)', () => {
  const session = async (sid: string) => {
    const token = `merge-${rand()}-${rand()}`
    await adminSql()`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${token}, ${[sid]}, ${sid})`
    return token
  }
  const ask = async (token: string) => (await anonymous((tx) => tx<{ ticket_id: string }[]>`select * from app.portal_ticket_create(${token}, 'documents', 'Fictional question about marks', 'Fictional question text')`))[0].ticket_id

  it('the conversation, number, company and assignee stay; the surviving record\'s portal sees it and can reply; the merged one cannot', async () => {
    const keep = await newStudent(); const drop = await newStudent()
    const dropToken = await session(drop); const keepToken = await session(keep)
    const t = await ask(dropToken)
    const mgr = await ctxFor(MGR)
    const staffUser = await userId(MGR)
    await tickets.replyTicket(mgr, t, 'Fictional staff answer', 'waiting_for_student', [])
    await adminSql()`update student_tickets set assigned_to = ${staffUser} where id = ${t}`
    const [before] = await adminSql()`select ticket_number, org_id, assigned_to, status, category, subject from student_tickets where id = ${t}`
    const msgs = await adminSql()`select id, author_type, body from student_ticket_messages where ticket_id = ${t} order by created_at, id`
    expect(msgs.length).toBe(2)
    await adminSql()`insert into portal_notices (student_id, kind, title) values (${drop}, 'ticket', 'Fictional answer notice')`
    await merge(keep, drop)
    const [after] = await adminSql()`select student_id, ticket_number, org_id, assigned_to, status, category, subject from student_tickets where id = ${t}`
    expect(after).toEqual({ ...before, student_id: keep })
    expect(await adminSql()`select id, author_type, body from student_ticket_messages where ticket_id = ${t} order by created_at, id`).toEqual(msgs)
    expect((await tickets.portalTickets(keepToken, {})).rows.map((r) => r.id)).toEqual([t])
    expect((await anonymous((tx) => tx<{ d: tickets.PortalTicket | null }[]>`select app.portal_ticket(${keepToken}, ${t}) as d`))[0].d!.messages.length).toBe(2)
    await anonymous((tx) => tx`select app.portal_ticket_reply(${keepToken}, ${t}, 'Fictional follow-up')`)
    expect((await anonymous((tx) => tx<{ d: unknown }[]>`select app.portal_ticket(${dropToken}, ${t}) as d`))[0].d).toBeNull()
    expect((await adminSql()`select student_id from portal_notices where kind = 'ticket' and title = 'Fictional answer notice' and student_id in (${keep}, ${drop})`)[0].student_id).toBe(keep)
    expect(await tickets.getTicket(await ctxFor('grd.manager@demo.test'), t)).toBeNull() // another company
    const d = (await tickets.getTicket(mgr, t))!
    expect(d.events.map((e) => e.action)).toContain('student_merged')
    expect((await adminSql()`select count(*)::int as n from audit_logs where action = 'ticket_student_merged' and entity_id = ${t}`)[0].n).toBe(1)
  })

  it('across companies a ticket stays with its company, and access follows the existing student rule', async () => {
    const keep = await newStudent(EDX); const drop = await newStudent(GRD)
    const t = await ask(await session(drop))
    await merge(keep, drop)
    expect((await adminSql()`select org_id, student_id from student_tickets where id = ${t}`)[0]).toEqual({ org_id: GRD, student_id: keep })
    expect(await tickets.getTicket(await ctxFor('grd.manager@demo.test'), t)).not.toBeNull()
    expect(await tickets.getTicket(await ctxFor('admin@demo.test'), t)).toBeNull() // no access to students
    // Existing rule, unchanged: ticket access follows access to the student, and a merge across companies shares the student.
    // So a counsellor of the surviving company can now read this question. Recorded in the report for the MD to decide.
    expect(await tickets.getTicket(await ctxFor('edx.counsellor@demo.test'), t)).not.toBeNull()
  })
})

describe('pre-admission links across a merge (BC-04)', () => {
  const C = 'edx.counsellor@demo.test'
  const finished = async () => {
    const id = await dvr.createDvr(await ctxFor(C), EDX, { prospectName: `Fictional Prospect ${rand()}`, prospectPhone: '+91 90000 00000', countryId: BG, universityId: BG_UNI, intake: 'Fictional 2027' })
    await adminSql()`update dvr_requests set status = 'closed' where id = ${id}`
    return id
  }

  it('the link moves, who linked and when stay, and it is recorded', async () => {
    const keep = await newStudent(); const drop = await newStudent(); const m = await ctxFor(MGR)
    const id = await finished()
    await dvr.linkDvrStudent(m, id, await codeOf(drop))
    const [before] = await adminSql()`select linked_by, linked_at, status, dvr_number, org_id from dvr_requests where id = ${id}`
    expect((await dvr.dvrLinksForStudent(m, drop)).map((d) => d.id)).toEqual([id])
    await merge(keep, drop)
    const [after] = await adminSql()`select linked_student_id, linked_by, linked_at, status, dvr_number, org_id from dvr_requests where id = ${id}`
    expect(after).toEqual({ ...before, linked_student_id: keep })
    expect((await dvr.dvrLinksForStudent(m, keep)).map((d) => d.id)).toEqual([id])
    expect(await dvr.dvrLinksForStudent(m, drop)).toEqual([])
    expect((await adminSql()`select note from dvr_events where request_id = ${id} and action = 'student_link_moved'`)[0].note).toContain(await codeOf(keep))
    const [a] = await adminSql()`select before_data, after_data from audit_logs where action = 'dvr_student_link_moved' and entity_id = ${id}`
    expect(a).toEqual({ before_data: { linked_student_id: drop }, after_data: { linked_student_id: keep } })
  })

  it('both records\' links are kept, without duplicates', async () => {
    const keep = await newStudent(); const drop = await newStudent(); const m = await ctxFor(MGR)
    const a = await finished(); const b = await finished()
    await dvr.linkDvrStudent(m, a, await codeOf(keep))
    await dvr.linkDvrStudent(m, b, await codeOf(drop))
    await merge(keep, drop)
    expect((await dvr.dvrLinksForStudent(m, keep)).map((d) => d.id).sort()).toEqual([a, b].sort())
  })

  it('nothing new can be linked to a merged record', async () => {
    const keep = await newStudent(); const drop = await newStudent(); const m = await ctxFor(MGR)
    await merge(keep, drop)
    const id = await finished()
    await refuses(dvr.linkDvrStudent(m, id, await codeOf(drop)))
    expect((await adminSql()`select linked_student_id from dvr_requests where id = ${id}`)[0].linked_student_id).toBeNull()
  })
})

describe('audit, permissions and failure', () => {
  it('the merge audit says what moved', async () => {
    const keep = await newStudent(); const drop = await newStudent(); const m = await ctxFor(MGR)
    await charge(drop, '100', 3); await charge(drop, '100', null)
    await pref.savePreference(m, drop, 2, { countryId: BG, universityId: BG_UNI })
    await merge(keep, drop, 'Fictional audit reason')
    const [a] = await adminSql()`select after_data, actor_user_id from audit_logs where action = 'merge' and entity_id = ${drop}`
    expect(a.actor_user_id).toBe(await userId(MD))
    expect(a.after_data).toMatchObject({ merged_into: keep, reason: 'Fictional audit reason', moved: { payment_entries: 2, due_dates: 1, preferences: 1, duplicate_preferences: 0, tickets: 0, pre_admission_links: 0 } })
    expect((await adminSql()`select surviving_student_id, reason from student_merges where merged_student_id = ${drop}`)[0]).toEqual({ surviving_student_id: keep, reason: 'Fictional audit reason' })
  })

  it('the re-created functions keep the same access: closed to PUBLIC, open to the application role', async () => {
    const rows = await adminSql()`select p.proname, has_function_privilege('public', p.oid, 'execute') as pub, has_function_privilege('erp_app', p.oid, 'execute') as app
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('merge_students', 'dvr_link_student') order by 1`
    expect(rows).toEqual([{ proname: 'dvr_link_student', pub: false, app: true }, { proname: 'merge_students', pub: false, app: true }])
  })

  it('someone without the merge permission, or from another company, cannot merge; nothing moves', async () => {
    const keep = await newStudent(); const drop = await newStudent()
    const c = await charge(drop, '100', 3)
    await refuses(students.mergeStudents(await ctxFor(FIN), keep, await codeOf(drop), 'Fictional'))
    await refuses(students.mergeStudents(await ctxFor('grd.manager@demo.test'), keep, await codeOf(drop), 'Fictional'))
    expect(await dueOwner(c)).toBe(drop)
    expect((await adminSql()`select status from students where id = ${drop}`)[0].status).not.toBe('merged')
  })

  it('a failure at the last step undoes the whole merge', async () => {
    const sql = adminSql()
    const keep = await newStudent(); const drop = await newStudent(); const m = await ctxFor(MGR)
    const c = await charge(drop, '50000', -2)
    await receipt(drop, '20000')
    await pref.savePreference(m, drop, 2, { countryId: BG, universityId: BG_UNI })
    const token = `merge-${rand()}-${rand()}`
    await sql`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${token}, ${[drop]}, ${drop})`
    const [{ ticket_id: t }] = await anonymous((tx) => tx<{ ticket_id: string }[]>`select * from app.portal_ticket_create(${token}, 'documents', 'Fictional failure case', 'Fictional text')`)
    const id = await dvr.createDvr(await ctxFor('edx.counsellor@demo.test'), EDX, { prospectName: 'Fictional Failure', prospectPhone: '+91 90000 00000', countryId: BG, universityId: BG_UNI, intake: 'Fictional 2027' })
    await sql`update dvr_requests set status = 'closed' where id = ${id}`
    await dvr.linkDvrStudent(m, id, await codeOf(drop))

    const ids = [keep, drop]
    const snapshot = async () => {
      const hash = async (q: Promise<{ m: string | null }[]>) => (await q)[0].m
      return {
        students: await hash(sql`select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) as m from students x where x.id = any(${ids}::uuid[])`),
        entries: await hash(sql`select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) as m from payment_entries x where x.student_id = any(${ids}::uuid[])`),
        due: await hash(sql`select md5(string_agg(to_jsonb(x)::text, ',' order by x.entry_id)) as m from payment_due_dates x where x.student_id = any(${ids}::uuid[])`),
        prefs: await hash(sql`select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) as m from student_preferences x where x.student_id = any(${ids}::uuid[])`),
        history: await hash(sql`select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) as m from student_preference_history x where x.student_id = any(${ids}::uuid[])`),
        tickets: await hash(sql`select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) as m from student_tickets x where x.id = ${t}`),
        ticketEvents: await hash(sql`select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) as m from student_ticket_events x where x.ticket_id = ${t}`),
        dvr: await hash(sql`select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) as m from dvr_requests x where x.id = ${id}`),
        dvrEvents: await hash(sql`select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) as m from dvr_events x where x.request_id = ${id}`),
        merges: (await sql`select count(*)::int as n from student_merges where merged_student_id = ${drop}`)[0].n,
        audit: (await sql`select count(*)::int as n from audit_logs where action in ('merge', 'ticket_student_merged', 'dvr_student_link_moved') and (entity_id = ${drop} or entity_id = ${t} or entity_id = ${id})`)[0].n,
      }
    }
    const before = await snapshot()
    await sql.unsafe(`create or replace function public.audit_merge_fail() returns trigger language plpgsql as $f$ begin raise exception 'simulated failure' using errcode = '23514'; end $f$`)
    await sql.unsafe(`create trigger audit_merge_fail before insert on student_merges for each row when (new.reason = 'Simulated failure') execute function public.audit_merge_fail()`)
    try {
      await refuses(merge(keep, drop, 'Simulated failure'))
    } finally {
      await sql.unsafe(`drop trigger audit_merge_fail on student_merges`)
      await sql.unsafe(`drop function public.audit_merge_fail()`)
    }
    expect(await snapshot()).toEqual(before)
    expect(await unpaid(c)).toBe('30000.00')
    await merge(keep, drop) // the same merge then succeeds
    expect(await unpaid(c)).toBe('30000.00')
    expect(await dueOwner(c)).toBe(keep)
  })
})
