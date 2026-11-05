/** Phase 7: pre-admission document verification. Fictional data. Creates no student; keeps versions and review history. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ServiceError } from '@/lib/errors'
import * as dvr from '@/services/dvr'
import * as secure from '@/services/secure-files'
import * as students from '@/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string; let GRD: string; let COUNTRY: string; let OTHER_COUNTRY: string; let UNI: string
const C = 'edx.counsellor@demo.test'; const C2 = 'edx.counsellor2@demo.test'; const D = 'docs@demo.test'; const MGR = 'edx.manager@demo.test'; const G = 'grd.counsellor@demo.test'; const SA = 'admin@demo.test'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
const pdf = (name = 'marksheet.pdf') => new File([new TextEncoder().encode(`%PDF-1.4\n% ${rand()}\n%%EOF`)], name, { type: 'application/pdf' })
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], 'photo.png', { type: 'image/png' })
async function refuses(p: Promise<unknown>, text?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (text) expect(`${(e as ServiceError).kind} ${(e as ServiceError).message}`).toContain(text); return }
  throw new Error('expected a refusal')
}
const form = (over: Record<string, unknown> = {}) => ({ prospectName: `Fictional Prospect ${rand()}`, prospectPhone: '+91 90000 00000', countryId: COUNTRY, universityId: UNI, intake: 'Fictional 2027', ...over })
const status = async (id: string) => (await adminSql()`select status from dvr_requests where id = ${id}`)[0].status as string
const docsOf = async (id: string) => adminSql()`select * from dvr_documents where request_id = ${id} and removed_at is null order by created_at, id`
const newRequest = async (over = {}) => dvr.createDvr(await ctxFor(C), EDX, form(over))
async function submitted(files = 1) {
  const id = await newRequest(); const c = await ctxFor(C)
  await dvr.addDvrDocuments(c, id, 'Marksheet', '', Array.from({ length: files }, () => pdf()))
  await dvr.submitDvr(c, id, '')
  return id
}
async function underReview(files = 1) {
  const id = await submitted(files); const d = await ctxFor(D)
  await dvr.assignDvr(d, id, await userId(D), '')
  await dvr.startDvr(d, id)
  return id
}

beforeAll(async () => {
  EDX = await orgId('EDX'); GRD = await orgId('GRD')
  const sql = adminSql()
  const [u] = await sql`select u.id, u.country_id from universities u join countries c on c.id = u.country_id where u.is_active and c.is_active limit 1`
  UNI = u.id; COUNTRY = u.country_id
  OTHER_COUNTRY = (await sql`select id from countries where is_active and id <> ${COUNTRY} limit 1`)[0].id
})
afterAll(async () => { await adminSql().end() })

describe('request', () => {
  it('numbers each company and year in sequence, and creates no student, student ID, portal account or application', async () => {
    const sql = adminSql()
    const count = async () => (await sql`select (select count(*)::int from students) as s, (select count(*)::int from portal_publications) as p`)[0]
    const before = await count()
    const a = await newRequest(); const b = await newRequest()
    const [x, y] = await sql`select dvr_number, status, linked_student_id from dvr_requests where id in (${a}, ${b}) order by dvr_number`
    expect(x.dvr_number).toMatch(new RegExp(`^DVR-${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format()}-\\d{6}$`))
    expect(Number(y.dvr_number.slice(-6))).toBe(Number(x.dvr_number.slice(-6)) + 1)
    expect(x).toMatchObject({ status: 'draft', linked_student_id: null })
    const g = await dvr.createDvr(await ctxFor(G), GRD, form())
    const [gr] = await sql`select dvr_number from dvr_requests where id = ${g}`
    expect(gr.dvr_number).toMatch(/^DVR-\d{4}-\d{6}$/)
    expect(await count()).toEqual(before)
  })

  it('requires a name, a contact, an active country and a university in that country', async () => {
    const c = await ctxFor(C)
    await refuses(dvr.createDvr(c, EDX, form({ prospectName: ' ' })), 'name')
    await refuses(dvr.createDvr(c, EDX, form({ prospectPhone: '', prospectEmail: '' })), 'phone number or an email')
    await refuses(dvr.createDvr(c, EDX, form({ countryId: '' })), 'destination country')
    await refuses(dvr.createDvr(c, EDX, form({ countryId: OTHER_COUNTRY })), 'not in the chosen country')
  })

  it('takes several PDFs as separate documents, refuses other types, and cannot be submitted empty', async () => {
    const c = await ctxFor(C); const id = await newRequest()
    await refuses(dvr.submitDvr(c, id, ''), 'at least one document')
    await refuses(dvr.addDvrDocuments(c, id, 'Photo', '', [png()]), 'Only PDF')
    expect(await docsOf(id)).toHaveLength(0)
    await refuses(dvr.addDvrDocuments(c, id, '', '', [pdf()]), 'category')
    expect(await dvr.addDvrDocuments(c, id, 'Marksheet', 'Grade 12', [pdf('a.pdf'), pdf('b.pdf')])).toBe(2)
    expect(await docsOf(id)).toHaveLength(2)
    await dvr.submitDvr(c, id, 'Please check the second one')
    expect(await status(id)).toBe('new_request')
    const ev = await adminSql()`select action, to_status, note from dvr_events where request_id = ${id} order by created_at, id`
    expect(ev.map((e) => e.to_status)).toEqual(expect.arrayContaining(['draft', 'submitted', 'new_request']))
  })
})

describe('access', () => {
  it('a draft is private to its counsellor and managers; a submitted one opens to Documentation, in the same company only', async () => {
    const id = await newRequest()
    const seen = async (who: string) => (await as(who, (tx) => tx`select id from dvr_requests where id = ${id}`)).length
    expect([await seen(C), await seen(MGR), await seen(D), await seen(C2), await seen(G), await seen(SA)]).toEqual([1, 1, 0, 0, 0, 0])
    await dvr.addDvrDocuments(await ctxFor(C), id, 'Marksheet', '', [pdf()])
    await dvr.submitDvr(await ctxFor(C), id, '')
    expect([await seen(D), await seen(C2), await seen(G), await seen(SA)]).toEqual([1, 0, 0, 0])
    expect(await dvr.getDvr(await ctxFor(G), id)).toBeNull()
    expect((await dvr.listDvr(await ctxFor(G), [EDX, GRD], { q: (await adminSql()`select dvr_number from dvr_requests where id = ${id}`)[0].dvr_number })).rows).toHaveLength(0)
  })

  it('files follow the request: other company and other counsellors cannot open them, and removing a version is refused', async () => {
    const id = await submitted(); const [doc] = await docsOf(id)
    const [f] = await adminSql()`select id from secure_files where context_type = 'dvr' and context_id = ${doc.id}`
    expect(await secure.openSecureFile(await ctxFor(D), f.id)).toBeTruthy()
    expect(await secure.openSecureFile(await ctxFor(C2), f.id)).toBeNull()
    expect(await secure.openSecureFile(await ctxFor(G), f.id)).toBeNull()
    await refuses(secure.removeSecureFile(await ctxFor(C), f.id))
    expect((await adminSql()`select removed_at from secure_files where id = ${f.id}`)[0].removed_at).toBeNull()
  })

  it('the application role cannot write the tables directly, and functions are closed to PUBLIC', async () => {
    const id = await submitted()
    await expectDbError(as(C, (tx) => tx`update dvr_requests set status = 'closed' where id = ${id}`), '42501')
    await expectDbError(as(C, (tx) => tx`insert into dvr_events (request_id, action) values (${id}, 'x')`), '42501')
    await expectDbError(as(C, (tx) => tx`select * from dvr_counters`), '42501')
    const open = await adminSql()`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and (p.proname like 'dvr\\_%' or p.proname like 'sf\\_dvr%') and has_function_privilege('public', p.oid, 'execute')`
    expect(open).toEqual([])
  })

  it('a portal student has no route to this data: no portal function mentions it', async () => {
    const rows = await adminSql()`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname like 'portal\\_%' and p.prosrc ilike '%dvr\\_%'`
    expect(rows).toEqual([])
  })

  it('only the assigned reviewer reviews; counsellors and managers cannot, and a counsellor cannot review their own request', async () => {
    const id = await submitted(); const [doc] = await docsOf(id); const d = await ctxFor(D)
    await refuses(dvr.startDvr(d, id), 'forbidden')
    await refuses(dvr.assignDvr(await ctxFor(C), id, await userId(D), ''), 'forbidden')
    await refuses(dvr.assignDvr(await ctxFor(MGR), id, await userId(C), ''))
    // Documentation can take an unassigned request, but cannot hand it to someone else
    await refuses(dvr.assignDvr(d, id, await userId('md@demo.test'), ''), 'forbidden')
    await dvr.assignDvr(await ctxFor(MGR), id, await userId(D), '')
    expect(await status(id)).toBe('assigned')
    await refuses(dvr.reviewDvrDocument(d, doc.id, 'verified', ''), 'Start verification')
    await refuses(dvr.startDvr(await ctxFor(MGR), id), 'forbidden')
    await dvr.startDvr(d, id)
    await refuses(dvr.reviewDvrDocument(await ctxFor(C), doc.id, 'verified', ''), 'forbidden')
    await refuses(dvr.reviewDvrDocument(await ctxFor(MGR), doc.id, 'verified', ''), 'forbidden')
  })
})

describe('review, return and resubmission', () => {
  it('counsellor to Documentation and back: corrected upload adds a version, and earlier versions and reviews stay', async () => {
    const id = await underReview(2); const c = await ctxFor(C); const d = await ctxFor(D)
    const [one, two] = await docsOf(id)
    await refuses(dvr.reviewDvrDocument(d, one.id, 'correction_required', ''), 'Say what is wrong')
    await dvr.reviewDvrDocument(d, one.id, 'verified', '')
    await dvr.reviewDvrDocument(d, two.id, 'correction_required', 'The page is cut off')
    await dvr.requestDvrDocument(d, id, 'Passport copy', 'First page is needed')
    await refuses(dvr.completeDvr(d, id, 'bogus', ''), 'overall')
    await dvr.sendBackDvr(d, id, 'correction_required', 'See the document notes')
    expect(await status(id)).toBe('correction_required')
    expect((await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${await userId(C)} and subject_id = ${id} and event_key = 'dvr_action_needed'`)[0].n).toBe(1)

    await refuses(dvr.submitDvr(c, id, ''), 'missing or corrected')
    await refuses(secure.uploadSecureFile(await ctxFor(D), 'dvr', two.id, pdf()))
    await secure.uploadSecureFile(c, 'dvr', two.id, pdf('corrected.pdf'))
    const docs = await docsOf(id)
    const missing = docs.find((x) => x.category === 'Passport copy')!
    await secure.uploadSecureFile(c, 'dvr', missing.id, pdf('passport.pdf'))
    expect((await docsOf(id)).filter((x) => x.result === 'correction_required' || x.result === 'missing_document')).toHaveLength(0)
    await dvr.submitDvr(c, id, 'Corrected')
    expect(await status(id)).toBe('resubmitted')

    await dvr.startDvr(d, id)
    const view = (await dvr.getDvr(d, id))!
    expect(view.files.filter((f) => f.context_id === two.id)).toHaveLength(2)
    expect(view.reviews.filter((x) => x.document_id === two.id).map((x) => x.notes)).toContain('The page is cut off')
    await refuses(dvr.completeDvr(d, id, 'possible', ''), 'every document')
    await dvr.reviewDvrDocument(d, two.id, 'verified', '')
    await dvr.reviewDvrDocument(d, missing.id, 'verified', '')
    await refuses(dvr.completeDvr(d, id, 'possible_with_conditions', ''), 'Explain')
    await dvr.completeDvr(d, id, 'possible_with_conditions', 'Depends on a fictional bridging course')
    expect(await status(id)).toBe('verification_completed')
    await refuses(dvr.returnDvr(c, id, ''), 'forbidden')
    await dvr.returnDvr(d, id, 'Done')
    expect(await status(id)).toBe('returned_to_counselor')
    expect((await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${await userId(C)} and subject_id = ${id} and event_key = 'dvr_returned'`)[0].n).toBe(1)
    const reviewed = await adminSql()`select count(*)::int as n from dvr_document_reviews where request_id = ${id}`
    expect(reviewed[0].n).toBeGreaterThanOrEqual(5)
    await dvr.closeDvr(c, id, '')
    expect(await status(id)).toBe('closed')
    await refuses(dvr.cancelDvr(c, id, 'Too late now'), 'finished')
  })

  it('reassignment needs a reason, is recorded, and only reaches people who can review', async () => {
    const id = await underReview(); const d = await ctxFor(D); const mgr = await ctxFor(MGR)
    const md = await userId('md@demo.test')
    await refuses(dvr.assignDvr(mgr, id, md, ''), 'reason')
    await refuses(dvr.assignDvr(mgr, id, await userId(C2), 'Cover for leave'), 'cannot review')
    await dvr.assignDvr(mgr, id, md, 'Cover for leave')
    const ev = await adminSql()`select note from dvr_events where request_id = ${id} and action = 'reassigned'`
    expect(ev[0].note).toBe('Cover for leave')
    await refuses(dvr.reviewDvrDocument(d, (await docsOf(id))[0].id, 'verified', ''), 'forbidden')
  })

  it('a change to country, university, programme or intake after start is logged and needs re-verification; before start it does not', async () => {
    const c = await ctxFor(C); const d = await ctxFor(D)
    const early = await newRequest()
    await dvr.updateDvr(c, early, form({ intake: 'Fictional 2028' }))
    expect((await adminSql()`select reverification_required as r from dvr_requests where id = ${early}`)[0].r).toBe(false)

    const id = await underReview(); const [doc] = await docsOf(id)
    await dvr.reviewDvrDocument(d, doc.id, 'verified', '')
    await dvr.completeDvr(d, id, 'possible', '')
    expect(await dvr.updateDvr(c, id, form({ intake: 'Fictional 2029' }))).toBe(true)
    const [r] = await adminSql()`select status, reverification_required, overall_result from dvr_requests where id = ${id}`
    expect(r).toMatchObject({ status: 'pending_further_review', reverification_required: true, overall_result: 'possible' })
    const ch = await adminSql()`select field, old_value, new_value, needs_reverification from dvr_field_changes where request_id = ${id}`
    expect(ch).toEqual([{ field: 'Intake', old_value: 'Fictional 2027', new_value: 'Fictional 2029', needs_reverification: true }])
    await dvr.startDvr(d, id)
    await dvr.completeDvr(d, id, 'possible', '')
    expect((await adminSql()`select reverification_required as r from dvr_requests where id = ${id}`)[0].r).toBe(false)
  })

  it('audit entries hold no prospect details or notes, and notification text is generic', async () => {
    const name = `Fictional Secret ${rand()}`
    const id = await newRequest({ prospectName: name, remarks: 'Secret remark' }); const c = await ctxFor(C)
    await dvr.addDvrDocuments(c, id, 'Marksheet', '', [pdf()])
    await dvr.submitDvr(c, id, 'Secret note')
    const audit = await adminSql()`select action, before_data::text as b, after_data::text as a, metadata::text as m from audit_logs where entity_type = 'dvr_requests' and entity_id = ${id}`
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(['dvr_created', 'dvr_submitted']))
    expect(JSON.stringify(audit)).not.toMatch(/Secret/)
    const notes = await adminSql()`select title from staff_notifications where subject_id = ${id}`
    expect(notes.length).toBeGreaterThan(0)
    expect(JSON.stringify(notes)).not.toMatch(/Secret/)
  })
})

describe('link to a student', () => {
  it('is explicit, only after completion, once, and changes nothing on the student', async () => {
    const d = await ctxFor(D); const mgr = await ctxFor(MGR); const sql = adminSql()
    const s = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: `Fictional Link ${rand()}`, phone: `+91 90077 ${rand().slice(0, 5)}` })
    const sid = typeof s === 'string' ? s : (s as { id: string }).id
    const [st] = await sql`select student_code, updated_at from students where id = ${sid}`
    const id = await underReview(); const [doc] = await docsOf(id)
    await refuses(dvr.linkDvrStudent(mgr, id, st.student_code), 'after verification')
    await dvr.reviewDvrDocument(d, doc.id, 'verified', '')
    await dvr.completeDvr(d, id, 'possible', '')
    await refuses(dvr.linkDvrStudent(await ctxFor(G), id, st.student_code))
    await refuses(dvr.linkDvrStudent(mgr, id, 'NOPE-0000'), 'No student')
    await refuses(dvr.linkDvrStudent(d, id, st.student_code))
    await dvr.linkDvrStudent(mgr, id, st.student_code)
    const [r] = await sql`select dvr_number, linked_student_id from dvr_requests where id = ${id}`
    expect(r.linked_student_id).toBe(sid)
    expect(r.dvr_number).toMatch(/^DVR-/)
    expect((await sql`select updated_at from students where id = ${sid}`)[0].updated_at).toEqual(st.updated_at)
    await refuses(dvr.linkDvrStudent(mgr, id, st.student_code), 'already linked')
    expect((await dvr.dvrLinksForStudent(mgr, sid)).map((x) => x.id)).toEqual([id])
  })
})
