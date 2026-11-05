/** Phase 8: questions from students through the portal. Fictional data. Students see only their own; staff follow student access. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as secure from '@/services/secure-files'
import * as students from '@/services/students'
import * as tickets from '@/services/tickets'
import { adminSql, as, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string
const C = 'edx.counsellor@demo.test'; const C2 = 'edx.counsellor2@demo.test'; const MGR = 'edx.manager@demo.test'; const MD = 'md@demo.test'; const SA = 'admin@demo.test'; const G = 'grd.manager@demo.test'; const D = 'docs@demo.test'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
const pdf = () => new File([new TextEncoder().encode(`%PDF-1.4\n% ${rand()}\n%%EOF`)], 'answer.pdf', { type: 'application/pdf' })
async function refuses(p: Promise<unknown>, text?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (text) expect(`${(e as ServiceError).kind} ${(e as ServiceError).message}`).toContain(text); return }
  throw new Error('expected a refusal')
}
async function student(assignee?: string) {
  const mgr = await ctxFor(MGR)
  const s = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: `Fictional Ticket ${rand()}`, phone: `+91 90088 ${rand().slice(0, 5)}` })
  const id = typeof s === 'string' ? s : (s as { id: string }).id
  const sql = adminSql()
  if (assignee) {
    await sql`update student_assignments set is_active = false, ended_at = now(), ended_by = ${mgr.userId} where student_id = ${id} and is_active`
    await sql`insert into student_assignments (student_id, user_id, org_id, assignment_type, assigned_by) values (${id}, ${await userId(assignee)}, ${EDX}, 'counsellor', ${mgr.userId})`
  }
  const token = `t-${rand()}-${rand()}`
  await sql`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${token}, ${[id]}, ${id})`
  return { id, token }
}
const ask = async (token: string, subject = `Fictional question ${rand()}`) => {
  const [r] = await anonymous((tx) => tx<{ ticket_id: string; message_id: string }[]>`select * from app.portal_ticket_create(${token}, 'documents', ${subject}, 'Fictional question text')`)
  return r
}
const view = async (token: string, id: string) => (await anonymous((tx) => tx<{ d: tickets.PortalTicket | null }[]>`select app.portal_ticket(${token}, ${id}) as d`))[0].d
const rowOf = async (id: string) => (await adminSql()`select * from student_tickets where id = ${id}`)[0]

beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end() })

describe('student side', () => {
  it('gets a reference, sees only their own, and an ended session gets nothing', async () => {
    const a = await student(); const b = await student()
    const q = await ask(a.token)
    const r = await rowOf(q.ticket_id)
    expect(r.ticket_number).toMatch(/^TKT-\d{4}-\d{6}$/)
    expect(r).toMatchObject({ status: 'open', student_id: a.id, org_id: EDX })
    expect(await view(b.token, q.ticket_id)).toBeNull()
    expect(await view('nobody', q.ticket_id)).toBeNull()
    const list = async (t: string) => (await tickets.portalTickets(t, {})).rows.map((x) => x.id)
    expect(await list(a.token)).toEqual([q.ticket_id])
    expect(await list(b.token)).toEqual([])
    await expectDbError(anonymous((tx) => tx`select * from app.portal_ticket_create('nobody', 'documents', 'A subject', 'Text')`), '42501')
    await expectDbError(anonymous((tx) => tx`select app.portal_ticket_reply(${b.token}, ${q.ticket_id}, 'Not mine')`), 'P0002')
    await adminSql()`update auth_private.portal_sessions set revoked_at = now() where token_hash = ${a.token}`
    expect(await view(a.token, q.ticket_id)).toBeNull()
  })

  it('validates input, searches and filters', async () => {
    const a = await student(); const code = `UniqueWord${rand()}`
    await expectDbError(anonymous((tx) => tx`select * from app.portal_ticket_create(${a.token}, 'bogus', 'A subject', 'Text')`), '23514')
    await expectDbError(anonymous((tx) => tx`select * from app.portal_ticket_create(${a.token}, 'visa', 'x', 'Text')`), '23514')
    await expectDbError(anonymous((tx) => tx`select * from app.portal_ticket_create(${a.token}, 'visa', 'A subject', ' ')`), '23514')
    const q = await ask(a.token, `About ${code}`); await ask(a.token)
    expect((await tickets.portalTickets(a.token, { q: code })).rows.map((x) => x.id)).toEqual([q.ticket_id])
    expect((await tickets.portalTickets(a.token, { status: 'closed' })).rows).toEqual([])
    expect((await tickets.portalTickets(a.token, { status: 'open' })).total).toBe(2)
  })

  it('shows no staff names, assignment or internal notes', async () => {
    const a = await student(); const q = await ask(a.token); const mgr = await ctxFor(MGR)
    await tickets.assignTicket(mgr, q.ticket_id, await userId(C), '')
    await tickets.replyTicket(mgr, q.ticket_id, 'Our fictional answer', 'in_progress', [])
    await tickets.setTicketStatus(mgr, q.ticket_id, 'waiting_for_student', 'Secret internal note')
    const seen = JSON.stringify(await view(a.token, q.ticket_id))
    expect(seen).toContain('Our fictional answer')
    expect(seen).not.toContain('Secret internal note')
    expect(seen).not.toContain(mgr.userId)
    expect(seen).not.toMatch(/assigned_to|author_id|full_name|Demo\)/)
  })
})

describe('staff access', () => {
  it('follows student access and company; System Admin and the other company see nothing', async () => {
    const a = await student(C); const q = await ask(a.token)
    const seen = async (who: string) => (await as(who, (tx) => tx`select id from student_tickets where id = ${q.ticket_id}`)).length
    expect(await seen(C)).toBe(1)
    expect(await seen(MGR)).toBe(1)
    expect(await seen(MD)).toBe(1)
    expect(await seen(C2)).toBe(1) // counsellors hold students.read.all in the default roles
    expect(await seen(G)).toBe(0)
    expect(await seen(SA)).toBe(0)
    expect(await tickets.getTicket(await ctxFor(G), q.ticket_id)).toBeNull()
    // without the right to read this student, a person who answers tickets does not see it, unless it is assigned to them
    const sql = adminSql()
    const removed = await sql`delete from role_permissions p using roles r where r.id = p.role_id and r.key = 'counsellor' and p.permission_key = 'students.read.all' returning p.role_id`
    try {
      expect(await seen(C2)).toBe(0)
      await tickets.assignTicket(await ctxFor(MGR), q.ticket_id, await userId(C2), '')
      expect(await seen(C2)).toBe(1)
    } finally {
      for (const r of removed) await sql`insert into role_permissions (role_id, permission_key) values (${r.role_id}, 'students.read.all') on conflict do nothing`
    }
    await expectDbError(as(G, (tx) => tx`select app.ticket_reply(${q.ticket_id}, 'Not mine', 'in_progress')`), 'P0002')
    await expectDbError(as(G, (tx) => tx`select app.ticket_set_status(${q.ticket_id}, 'closed', '')`), 'P0002')
  })

  it('the application role cannot write directly, and functions are closed to PUBLIC', async () => {
    const a = await student(C); const q = await ask(a.token)
    await expectDbError(as(C, (tx) => tx`update student_tickets set status = 'closed' where id = ${q.ticket_id}`), '42501')
    await expectDbError(as(C, (tx) => tx`insert into student_ticket_messages (ticket_id, org_id, author_type, body) values (${q.ticket_id}, ${EDX}, 'student', 'Forged')`), '42501')
    await expectDbError(as(C, (tx) => tx`select * from student_ticket_counters`), '42501')
    const open = await adminSql()`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and (p.proname like '%ticket%') and has_function_privilege('public', p.oid, 'execute')`
    expect(open).toEqual([])
  })

  it('assignment: managers assign, others only to themselves; a reason is needed to take it over; only eligible people', async () => {
    const a = await student(C); const q = await ask(a.token); const c = await ctxFor(C); const mgr = await ctxFor(MGR)
    await refuses(tickets.assignTicket(c, q.ticket_id, await userId(D), ''), 'forbidden')
    await refuses(tickets.assignTicket(mgr, q.ticket_id, await userId(SA), ''), 'cannot answer')
    await tickets.assignTicket(c, q.ticket_id, c.userId, '')
    await refuses(tickets.assignTicket(mgr, q.ticket_id, await userId(D), ''), 'reason')
    await tickets.assignTicket(mgr, q.ticket_id, await userId(D), 'Documents question')
    const ev = await adminSql()`select action, note from student_ticket_events where ticket_id = ${q.ticket_id} and action = 'reassigned'`
    expect(ev[0].note).toBe('Documents question')
    expect((await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${await userId(D)} and subject_id = ${q.ticket_id} and event_key = 'ticket_assigned'`)[0].n).toBe(1)
    const stillRead = await tickets.getTicket(await ctxFor(D), q.ticket_id)
    expect(stillRead).not.toBeNull()
  })
})

describe('conversation', () => {
  it('replies move the status, both sides are told, closed is final, and history stays', async () => {
    const a = await student(C); const q = await ask(a.token); const c = await ctxFor(C); const mgr = await ctxFor(MGR)
    expect((await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${await userId(C)} and subject_id = ${q.ticket_id} and event_key = 'ticket_new'`)[0].n).toBe(1)
    await refuses(tickets.replyTicket(c, q.ticket_id, ' ', 'in_progress', []), 'Enter your reply')
    await refuses(tickets.replyTicket(c, q.ticket_id, 'Text', 'closed', []), 'next status')
    await tickets.replyTicket(c, q.ticket_id, 'Fictional answer', 'waiting_for_student', [])
    let r = await rowOf(q.ticket_id)
    expect(r).toMatchObject({ status: 'waiting_for_student', last_from: 'staff', assigned_to: c.userId })
    const notices = await adminSql()`select kind, title, body from portal_notices where student_id = ${a.id} and kind = 'ticket'`
    expect(notices).toHaveLength(1)
    expect(notices[0].body).toContain(r.ticket_number)
    expect(notices[0].body).not.toContain('Fictional answer')

    await anonymous((tx) => tx`select app.portal_ticket_reply(${a.token}, ${q.ticket_id}, 'Thank you')`)
    r = await rowOf(q.ticket_id)
    expect(r).toMatchObject({ status: 'in_progress', last_from: 'student' })
    expect((await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${c.userId} and subject_id = ${q.ticket_id} and event_key = 'ticket_reply'`)[0].n).toBe(1)

    await tickets.setTicketStatus(c, q.ticket_id, 'resolved', '')
    expect((await rowOf(q.ticket_id)).resolved_at).not.toBeNull()
    await anonymous((tx) => tx`select app.portal_ticket_reply(${a.token}, ${q.ticket_id}, 'One more thing')`)
    r = await rowOf(q.ticket_id)
    expect(r).toMatchObject({ status: 'open', resolved_at: null })

    await tickets.setTicketStatus(mgr, q.ticket_id, 'closed', '')
    await expectDbError(anonymous((tx) => tx`select app.portal_ticket_reply(${a.token}, ${q.ticket_id}, 'Too late')`), '23514')
    await refuses(tickets.replyTicket(c, q.ticket_id, 'Too late', 'in_progress', []), 'closed')
    await refuses(tickets.setTicketStatus(mgr, q.ticket_id, 'open', ''), 'closed')
    expect((await view(a.token, q.ticket_id))!.messages.map((m) => m.body)).toEqual(['Fictional question text', 'Fictional answer', 'Thank you', 'One more thing'])
    expect((await tickets.portalTickets(a.token, { status: 'closed' })).total).toBe(1)
  })

  it('attachments work both ways and stay closed to anyone else; they cannot be removed', async () => {
    const a = await student(C); const b = await student(); const q = await ask(a.token); const c = await ctxFor(C)
    await tickets.replyTicket(c, q.ticket_id, 'See attached', 'in_progress', [pdf()])
    const [f] = await adminSql()`select f.id, f.context_id from secure_files f join student_ticket_messages m on m.id = f.context_id where m.ticket_id = ${q.ticket_id}`
    expect(await secure.openSecureFile(c, f.id)).toBeTruthy()
    expect(await secure.openSecureFile(await ctxFor(G), f.id)).toBeNull()
    await refuses(secure.removeSecureFile(c, f.id))
    const dl = (t: string, id: string) => anonymous((tx) => tx`select * from app.portal_ticket_file(${t}, ${id}, '127.0.0.1')`)
    expect(await dl(a.token, f.id)).toHaveLength(1)
    expect(await dl(b.token, f.id)).toHaveLength(0)
    expect(await dl('nobody', f.id)).toHaveLength(0)
    const au = await adminSql()`select outcome from audit_logs where action = 'ticket_file_download' and entity_id = ${f.id} order by occurred_at`
    expect(au.map((x) => x.outcome)).toEqual(['success', 'denied', 'denied'])

    // a student file is recorded with no staff uploader; another student cannot attach to it; a student cannot open other file contexts
    await expectDbError(anonymous((tx) => tx`select app.portal_ticket_register_file(${b.token}, ${q.message_id}, ${'k' + rand()}, 'x.pdf', 'application/pdf', 10, ${'a'.repeat(64)})`), '42501')
    const fid = await anonymous((tx) => tx<{ id: string }[]>`select app.portal_ticket_register_file(${a.token}, ${q.message_id}, ${'k' + rand()}, 'mine.pdf', 'application/pdf', 10, ${'a'.repeat(64)}) as id`)
    expect((await adminSql()`select uploaded_by from secure_files where id = ${fid[0].id}`)[0].uploaded_by).toBeNull()
    await expect(adminSql()`insert into secure_files (org_id, context_type, context_id, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by) values (${EDX}, 'task', ${q.message_id}, ${'k' + rand()}, 'x.pdf', 'application/pdf', 10, ${'a'.repeat(64)}, null)`).rejects.toMatchObject({ code: '23514' })
    const taskFile = await adminSql()`select id from secure_files where context_type <> 'ticket' limit 1`
    if (taskFile[0]) expect(await dl(a.token, taskFile[0].id)).toHaveLength(0)
  })

  it('audit entries hold no question text', async () => {
    const a = await student(C); const q = await ask(a.token, 'Secret subject here')
    await tickets.replyTicket(await ctxFor(C), q.ticket_id, 'Secret answer', 'in_progress', [])
    const au = await adminSql()`select action, before_data::text as b, after_data::text as a, metadata::text as m from audit_logs where entity_type = 'student_tickets' and entity_id = ${q.ticket_id}`
    expect(au.map((x) => x.action)).toEqual(expect.arrayContaining(['ticket_created', 'ticket_staff_replied']))
    expect(JSON.stringify(au)).not.toMatch(/Secret|Fictional question/)
    const n = await adminSql()`select title from staff_notifications where subject_id = ${q.ticket_id}`
    expect(JSON.stringify(n)).not.toMatch(/Secret/)
  })

  it('a student cannot reach internal modules: no portal function returns staff tables', async () => {
    const rows = await adminSql()`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname like 'portal\\_%' and (p.prosrc ~* '\\m(chat_messages|meetings|meeting_minutes|tasks|chatgov_[a-z_]+|dvr_[a-z_]+)\\M')`
    expect(rows).toEqual([])
  })
})
