/** Phase 0: every migration from 0017 has a rollback; rolling back and re-applying works. */
import { existsSync, readdirSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { ROLLBACK_REQUIRED_FROM, rollbackFileFor, rollbackTo, runMigrations } from '../../scripts/lib/migrations'
import { provision } from '../../scripts/lib/provision'
import { adminSql, as } from '../support/helpers'
import path from 'node:path'

afterAll(async () => { await adminSql().end() })

describe('0052: chat notifications', () => {
  it('rolls back with no change to messages or read state, and re-applies', async () => {
    const url = process.env.DATABASE_ADMIN_URL!; const quiet = () => {}
    const data = async () => (await adminSql()`select (select count(*)::int from chat_messages) as messages, (select coalesce(md5(string_agg(concat_ws('|', conversation_id, user_id, last_read_at, left_at), ',' order by conversation_id, user_id)), '') from chat_members) as members`)[0]
    const objects = async () => (await adminSql()`select to_regclass('public.chat_notification_settings') as a, to_regclass('public.chat_conversation_mutes') as b, to_regprocedure('app.auth_peek_session(text)') as c`)[0]
    const before = await data()
    expect((await objects()).a).toBe('chat_notification_settings')
    await rollbackTo(url, '0052', quiet)
    expect(await objects()).toEqual({ a: null, b: null, c: null })
    expect(await data()).toEqual(before)
    await runMigrations(url, { log: quiet })
    expect((await objects()).b).toBe('chat_conversation_mutes')
    expect(await data()).toEqual(before)
  })
})

describe('0051: student merge fixes', () => {
  it('rolls back with real merges in place, leaves the moved records and the ledger alone, and re-applies', async () => {
    const url = process.env.DATABASE_ADMIN_URL!; const quiet = () => {}; const sql = adminSql()
    const objects = async () => (await sql`select
      (select count(*)::int from information_schema.columns where table_name = 'payment_due_dates' and column_name = 'settled_on_merge') as settled,
      (select count(*)::int from information_schema.columns where table_name = 'student_preference_history' and column_name = 'note') as note,
      (select pg_get_functiondef('app.merge_students(uuid, uuid, text)'::regprocedure) like '%settled_on_merge%') as merge,
      (select pg_get_functiondef('app.dvr_link_student(uuid, uuid)'::regprocedure) like '%was merged%') as link,
      (select pg_get_viewdef('payment_due_status'::regclass) like '%settled%') as view`)[0]
    expect(await objects()).toEqual({ settled: 1, note: 1, merge: true, link: true, view: true })
    const [o] = await sql`select id from organizations where code = 'EDX'`
    const [cat] = await sql`select id from fee_categories where org_id = ${o.id} and kind = 'service' limit 1`
    const [u] = await sql`select id from user_profiles where email = 'edx.finance@demo.test'`
    const [md] = await sql`select id from user_profiles where email = 'md@demo.test'`
    const [keep, drop] = await sql`select student_id as id from student_org_access a join students s on s.id = a.student_id where a.org_id = ${o.id} and a.relation = 'originating' and s.status <> 'merged' order by s.created_at desc limit 2`
    const [e] = await as('edx.finance@demo.test', (tx) => tx`insert into payment_entries (org_id, student_id, entry_type, fee_category_id, amount) values (${o.id}, ${drop.id}, 'charge', ${cat.id}, 10) returning id`)
    await sql`insert into payment_due_dates (entry_id, org_id, student_id, due_date, set_by) values (${e.id}, ${o.id}, ${drop.id}, current_date, ${u.id})`
    const [c] = await sql`select id from countries where is_active limit 1`
    await sql`insert into student_preferences (student_id, rank, country_id, updated_by) values (${drop.id}, 3, ${c.id}, ${u.id}) on conflict do nothing`
    await sql.begin(async (tx) => { await tx`select set_config('app.user_id', ${md.id}, true)`; await tx`select app.merge_students(${keep.id}, ${drop.id}, 'Fictional rollback case')` })
    expect((await sql`select student_id from payment_due_dates where entry_id = ${e.id}`)[0].student_id).toBe(keep.id)
    const hash = async () => (await sql`select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) as m, count(*)::int as n from payment_entries x`)[0]
    const before = await hash()
    const history = (await sql`select count(*)::int as n from student_preference_history where action in ('saved', 'cleared')`)[0].n

    await rollbackTo(url, '0051', quiet)
    expect((await sql`select count(*)::int as n from information_schema.columns where table_name = 'payment_due_dates' and column_name = 'settled_on_merge'`)[0].n).toBe(0)
    expect((await sql`select pg_get_functiondef('app.merge_students(uuid, uuid, text)'::regprocedure) like '%payment_due_dates%' as x`)[0].x).toBe(false)
    expect((await sql`select student_id from payment_due_dates where entry_id = ${e.id}`)[0].student_id).toBe(keep.id)
    expect((await sql`select count(*)::int as n from student_preferences where student_id = ${drop.id}`)[0].n).toBe(0)
    expect((await sql`select unpaid::text as u from payment_due_status where entry_id = ${e.id}`).length).toBe(1)
    expect(await hash()).toEqual(before)
    expect((await sql`select count(*)::int as n from student_preference_history where action in ('saved', 'cleared')`)[0].n).toBe(history)
    await expect(sql`insert into student_preference_history (student_id, rank, action, changed_by) values (${keep.id}, 2, 'merged_in', ${u.id})`).rejects.toMatchObject({ code: '23514' })

    await runMigrations(url, { log: quiet })
    expect(await objects()).toEqual({ settled: 1, note: 1, merge: true, link: true, view: true })
    expect(await hash()).toEqual(before)
  })

  it('a due date left behind by an earlier merge is repaired when 0051 is applied', async () => {
    const url = process.env.DATABASE_ADMIN_URL!; const quiet = () => {}; const sql = adminSql()
    const [o] = await sql`select id from organizations where code = 'EDX'`
    const [cat] = await sql`select id from fee_categories where org_id = ${o.id} and kind = 'service' limit 1`
    const [u] = await sql`select id from user_profiles where email = 'edx.finance@demo.test'`
    const [a, b] = await sql`select student_id as id from student_org_access a join students s on s.id = a.student_id where a.org_id = ${o.id} and a.relation = 'originating' and s.status <> 'merged' order by s.created_at limit 2`
    const [e] = await as('edx.finance@demo.test', (tx) => tx`insert into payment_entries (org_id, student_id, entry_type, fee_category_id, amount) values (${o.id}, ${a.id}, 'charge', ${cat.id}, 10) returning id`)
    await rollbackTo(url, '0051', quiet)
    await sql`insert into payment_due_dates (entry_id, org_id, student_id, due_date, set_by) values (${e.id}, ${o.id}, ${b.id}, current_date, ${u.id})`
    await runMigrations(url, { log: quiet })
    expect((await sql`select student_id from payment_due_dates where entry_id = ${e.id}`)[0].student_id).toBe(a.id)
  })
})

describe('0047: chat governance', () => {
  it('rolls back cleanly, keeps the message archive, and re-applies', async () => {
    const url = process.env.DATABASE_ADMIN_URL!; const quiet = () => {}; const sql = adminSql()
    const objects = async () => (await sql`select
      (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name like 'chatgov\\_%') as tables,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname like 'chatgov\\_%') as fns,
      (select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'chatgov\\_%') as policies,
      (select count(*)::int from pg_trigger where tgname = 'chat_message_history_guard') as guard`)[0]
    expect(await objects()).toEqual({ tables: 6, fns: 20, policies: 6, guard: 1 })
    const [a, b] = await sql`select id from user_profiles where email in ('edx.counsellor@demo.test', 'edx.counsellor2@demo.test') order by email`
    const [org] = await sql`select id from organizations where code = 'EDX'`
    const [c] = await sql`insert into chat_conversations (org_id, kind, direct_key, created_by) values (${org.id}, 'direct', ${'rollback47:' + a.id}, ${a.id}) returning id`
    const [m] = await sql`insert into chat_messages (conversation_id, org_id, sender_id, body) values (${c.id}, ${org.id}, ${a.id}, '') returning id`
    await sql`insert into chat_message_history (message_id, previous_body, action, actor_id) values (${m.id}, 'Fictional archived text', 'retention_archived', null), (${m.id}, 'Fictional edited text', 'edited', ${b.id})`
    const [q] = await sql`insert into chatgov_requests (org_id, reference, reason, scope_user, reader_id, requested_by) values (${org.id}, 'CASE-R', 'A fictional rollback case', ${a.id}, ${b.id}, ${a.id}) returning id`
    await sql`insert into chatgov_access_log (request_id, org_id, accessor_id, message_ids) values (${q.id}, ${org.id}, ${b.id}, ${[m.id]})`

    await rollbackTo(url, '0047', quiet)
    expect(await objects()).toEqual({ tables: 0, fns: 0, policies: 0, guard: 0 })
    const kept = await sql`select action, previous_body from chat_message_history where message_id = ${m.id} order by previous_body`
    expect(kept.map((r) => [r.action, r.previous_body])).toEqual([['deleted', 'Fictional archived text'], ['edited', 'Fictional edited text']])

    await runMigrations(url, { log: quiet })
    expect(await objects()).toEqual({ tables: 6, fns: 20, policies: 6, guard: 1 })
    await expect(sql`delete from chat_message_history where message_id = ${m.id}`).rejects.toMatchObject({ code: '42501' })
  })
})

describe('0050: finance due dates', () => {
  it('rolls back with real due dates, leaves every payment entry alone, and re-applies', async () => {
    const url = process.env.DATABASE_ADMIN_URL!; const quiet = () => {}; const sql = adminSql()
    const objects = async () => (await sql`select
      (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name in ('payment_due_dates', 'payment_due_status')) as objs,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('set_payment_due_date', 'payment_due_reminders')) as fns`)[0]
    expect(await objects()).toEqual({ objs: 2, fns: 2 })
    const hash = async () => (await sql`select coalesce(md5(string_agg(x::text, ',' order by x.id)), '') as m, count(*)::int as n from payment_entries x`)[0]
    const [o] = await sql`select id from organizations where code = 'EDX'`
    const [st] = await sql`select student_id as id from student_org_access where org_id = ${o.id} limit 1`
    const [cat] = await sql`select id from fee_categories where org_id = ${o.id} and kind = 'service' limit 1`
    const [u] = await sql`select id from user_profiles where email = 'edx.finance@demo.test'`
    const [e] = await as('edx.finance@demo.test', (tx) => tx`insert into payment_entries (org_id, student_id, entry_type, fee_category_id, amount) values (${o.id}, ${st.id}, 'charge', ${cat.id}, 10) returning id`)
    await sql`insert into payment_due_dates (entry_id, org_id, student_id, due_date, set_by) values (${e.id}, ${o.id}, ${st.id}, current_date, ${u.id})`
    const before = await hash()
    expect(before.n).toBeGreaterThan(0)
    await rollbackTo(url, '0050', quiet)
    expect(await objects()).toEqual({ objs: 0, fns: 0 })
    expect(await hash()).toEqual(before)
    await runMigrations(url, { log: quiet })
    expect(await objects()).toEqual({ objs: 2, fns: 2 })
    expect(await hash()).toEqual(before)
  })
})

describe('0049: preferences and admission rules', () => {
  it('rolls back cleanly, keeps other notices and the comparison working, and re-applies', async () => {
    const url = process.env.DATABASE_ADMIN_URL!; const quiet = () => {}; const sql = adminSql()
    const objects = async () => (await sql`select
      (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name in ('academic_years', 'student_preferences', 'student_preference_history', 'country_document_rules')) as tables,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('save_academic_year', 'student_preference_save', 'student_preference_clear', 'save_country_document_rule', 'verify_country_document_rule', 'set_country_document_rule_active', 'student_preference_requirements', 'student_advisories_for')) as fns,
      (select count(*)::int from information_schema.columns where table_name = 'advisory_notices' and column_name = 'intake_id') as col,
      (select count(*)::int from permissions where key = 'requirements.verify') as perm`)[0]
    expect(await objects()).toEqual({ tables: 4, fns: 8, col: 1, perm: 1 })
    const hash = async (t: string) => (await sql.unsafe(`select coalesce(md5(string_agg(x::text, ',' order by x.id)), '') as m from ${t} x`))[0].m
    const [st] = await sql`select id from students where destination_country_id is not null limit 1`
    const [y] = await sql`insert into academic_years (code) values ('2099-00') returning id`
    const [c] = await sql`select destination_country_id as id from students where id = ${st.id}`
    const [u] = await sql`select id from user_profiles limit 1`
    await sql`insert into student_preferences (student_id, rank, country_id, academic_year_id, updated_by) values (${st.id}, 3, ${c.id}, ${y.id}, ${u.id}) on conflict do nothing`
    const data = { students: await hash('students'), notices: (await sql`select count(*)::int as n from advisory_notices`)[0].n }
    const advice = async () => (await sql`select count(*)::int as n from app.student_advisories(${st.id})`)[0].n
    const before = await advice()
    await rollbackTo(url, '0049', quiet)
    expect(await objects()).toEqual({ tables: 0, fns: 0, col: 0, perm: 0 })
    expect({ students: await hash('students'), notices: (await sql`select count(*)::int as n from advisory_notices`)[0].n }).toEqual(data)
    expect(await advice()).toBe(before)
    await runMigrations(url, { log: quiet })
    expect(await objects()).toEqual({ tables: 4, fns: 8, col: 1, perm: 1 })
    expect(await advice()).toBe(before)
  })
})

describe('0048: student tickets', () => {
  it('rolls back cleanly, removes only ticket data, restores file and notice rules, and re-applies', async () => {
    const url = process.env.DATABASE_ADMIN_URL!; const quiet = () => {}; const sql = adminSql()
    const objects = async () => (await sql`select
      (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name like 'student\\_ticket%') as tables,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname like '%ticket%') as fns,
      (select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'student\\_ticket%') as policies,
      (select count(*)::int from permissions where key like 'tickets.%') as perms,
      (select is_nullable from information_schema.columns where table_name = 'secure_files' and column_name = 'uploaded_by') as nullable`)[0]
    expect(await objects()).toEqual({ tables: 4, fns: 19, policies: 3, perms: 2, nullable: 'YES' })
    const hash = async (t: string) => (await sql.unsafe(`select coalesce(md5(string_agg(x::text, ',' order by x.id)), '') as m from ${t} x`))[0].m
    const others = async () => ({ students: await hash('students'), tasks: await hash('tasks'), dvr: await hash('dvr_requests') })
    const [o] = await sql`select id from organizations where code = 'EDX'`
    const [st] = await sql`select id from students where originating_org_id = ${o.id} limit 1`
    const [t] = await sql`insert into student_tickets (org_id, ticket_number, student_id, category, subject) values (${o.id}, 'TKT-2026-999999', ${st.id}, 'other', 'Fictional rollback') returning id`
    const [m] = await sql`insert into student_ticket_messages (ticket_id, org_id, author_type, body) values (${t.id}, ${o.id}, 'student', 'Fictional') returning id`
    await sql`insert into secure_files (org_id, context_type, context_id, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by) values (${o.id}, 'ticket', ${m.id}, 'rollback-48-test', 'x.pdf', 'application/pdf', 10, ${'a'.repeat(64)}, null)`
    await sql`insert into portal_notices (student_id, kind, title) values (${st.id}, 'ticket', 'Fictional rollback')`
    const data = await others()
    await rollbackTo(url, '0048', quiet)
    expect(await objects()).toEqual({ tables: 0, fns: 0, policies: 0, perms: 0, nullable: 'NO' })
    expect(await others()).toEqual(data)
    const [{ def }] = await sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'secure_files_context_type_check'`
    expect(def).toContain('dvr')
    expect(def).not.toContain('ticket')
    await runMigrations(url, { log: quiet })
    expect(await objects()).toEqual({ tables: 4, fns: 19, policies: 3, perms: 2, nullable: 'YES' })
  })
})

describe('0046: pre-admission verification', () => {
  it('rolls back cleanly with 0047 re-applied after, removes only DVR data, restores the file rules', async () => {
    const url = process.env.DATABASE_ADMIN_URL!; const quiet = () => {}; const sql = adminSql()
    const objects = async () => (await sql`select
      (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name like 'dvr\\_%') as tables,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and (p.proname like 'dvr\\_%' or p.proname like 'sf\\_dvr%')) as fns,
      (select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'dvr\\_%') as policies,
      (select count(*)::int from permissions where key like 'dvr.%') as perms,
      (select count(*)::int from pg_trigger where tgname = 'secure_files_dvr_version') as trg`)[0]
    expect(await objects()).toEqual({ tables: 6, fns: 27, policies: 5, perms: 3, trg: 1 })
    const hash = async (t: string) => (await sql.unsafe(`select coalesce(md5(string_agg(x::text, ',' order by x.id)), '') as m from ${t} x`))[0].m
    const others = async () => ({ tasks: await hash('tasks'), students: await hash('students'), chat: await hash('chat_messages') })
    // real rows, including a review that points at a file: the rollback has to cope with them
    const [u] = await sql`select id from user_profiles where email = 'edx.counsellor@demo.test'`
    const [o] = await sql`select id from organizations where code = 'EDX'`
    const [c] = await sql`select id from countries where is_active limit 1`
    const [r] = await sql`insert into dvr_requests (org_id, dvr_number, prospect_name, prospect_phone, destination_country_id, counsellor_id) values (${o.id}, 'DVR-2026-999999', 'Fictional Rollback', '+91 90000 00000', ${c.id}, ${u.id}) returning id`
    const [d] = await sql`insert into dvr_documents (request_id, org_id, category, created_by) values (${r.id}, ${o.id}, 'Marksheet', ${u.id}) returning id`
    const [f] = await sql`insert into secure_files (org_id, context_type, context_id, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by) values (${o.id}, 'dvr', ${d.id}, 'rollback-46-test', 'x.pdf', 'application/pdf', 10, ${'a'.repeat(64)}, ${u.id}) returning id`
    await sql`insert into dvr_document_reviews (document_id, request_id, file_id, result, reviewed_by) values (${d.id}, ${r.id}, ${f.id}, 'verified', ${u.id})`
    const data = await others()
    const applied = async () => (await sql`select count(*)::int as n from schema_migrations where version like '0047%'`)[0].n
    // the rollback runner undoes newest first, and 0047 sorts after 0046
    await rollbackTo(url, '0046', quiet)
    expect(await objects()).toEqual({ tables: 0, fns: 0, policies: 0, perms: 0, trg: 0 })
    expect((await sql`select count(*)::int as n from secure_files where context_type = 'dvr'`)[0].n).toBe(0)
    expect(await applied()).toBe(0)
    expect(await others()).toEqual(data)
    const [{ def }] = await sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'secure_files_context_type_check'`
    expect(def).not.toContain('dvr')
    await runMigrations(url, { log: quiet })
    expect(await objects()).toEqual({ tables: 6, fns: 27, policies: 5, perms: 3, trg: 1 })
    expect(await applied()).toBe(1)
  })
})

describe('0045: internal chat', () => {
  it('rolls back cleanly, removes only chat data, restores the file rules, and re-applies', async () => {
    const url = process.env.DATABASE_ADMIN_URL!
    const quiet = () => {}
    const sql = adminSql()
    const objects = async () => (await sql`select
      (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name like 'chat\\_%') as tables,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and (p.proname like 'chat\\_%' or p.proname like 'sf\\_chat%')) as fns,
      (select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'chat\\_%') as policies,
      (select count(*)::int from permissions where key = 'chat.groups.manage') as perm`)[0]
    const hash = async (t: string) => (await sql.unsafe(`select coalesce(md5(string_agg(x::text, ',' order by x.id)), '') as m from ${t} x`))[0].m
    const others = async () => ({ tasks: await hash('tasks'), meetings: await hash('meetings'), students: await hash('students'), files: await hash("(select * from secure_files where context_type <> 'chat') ") })
    const before = await objects(); const data = await others()
    expect(before).toEqual({ tables: 8, fns: 20, policies: 7, perm: 1 }) // 0052 adds 2 tables, 2 functions and 2 policies with chat names

    // fictional chat data, with a notification and an attachment record, so the rollback has something to remove
    const [a, b] = await sql`select id from user_profiles where email in ('edx.counsellor@demo.test', 'edx.counsellor2@demo.test') order by email`
    const [org] = await sql`select id from organizations where code = 'EDX'`
    const [c] = await sql`insert into chat_conversations (org_id, kind, direct_key, created_by) values (${org.id}, 'direct', ${a.id + ':' + b.id}, ${a.id}) returning id`
    await sql`insert into chat_members (conversation_id, user_id, org_id) values (${c.id}, ${a.id}, ${org.id}), (${c.id}, ${b.id}, ${org.id})`
    const [m] = await sql`insert into chat_messages (conversation_id, org_id, sender_id, body) values (${c.id}, ${org.id}, ${a.id}, 'Fictional rollback text') returning id`
    await sql`insert into chat_message_history (message_id, previous_body, action, actor_id) values (${m.id}, 'Earlier fictional text', 'edited', ${a.id})`
    await sql`insert into chat_reactions (message_id, user_id, emoji) values (${m.id}, ${b.id}, '👍')`
    await sql`insert into staff_notifications (user_id, org_id, event_key, title, href, subject_type, subject_id, severity) values (${b.id}, ${org.id}, 'chat_message', 'You have a new direct message', '/chat', 'chat', ${c.id}, 'info')`
    await sql`insert into secure_files (org_id, context_type, context_id, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by)
              values (${org.id}, 'chat', ${m.id}, ${'rollback/' + m.id}, 'fictional.pdf', 'application/pdf', 10, ${'a'.repeat(64)}, ${a.id})`

    await rollbackTo(url, '0045', quiet)
    expect(await sql`select to_regclass('public.chat_messages') as t`).toEqual([{ t: null }])
    const [after] = await sql`select (select count(*)::int from secure_files where context_type = 'chat') as files, (select count(*)::int from staff_notifications where subject_type = 'chat') as notes,
      (select count(*)::int from permissions where key = 'chat.groups.manage') as perm, (select count(*)::int from role_permissions where permission_key = 'chat.groups.manage') as grants,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and (p.proname like 'chat\\_%' or p.proname like 'sf\\_chat%')) as fns,
      (select pg_get_functiondef('app.secure_file_can_read(text, uuid)'::regprocedure) like '%sf_chat%') as dispatch,
      (select pg_get_constraintdef(oid) like '%chat%' from pg_constraint where conname = 'secure_files_context_type_check') as ctx`
    expect(after).toEqual({ files: 0, notes: 0, perm: 0, grants: 0, fns: 0, dispatch: false, ctx: false })
    await expect(sql`insert into secure_files (org_id, context_type, context_id, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by)
              values (${org.id}, 'chat', ${m.id}, 'rollback/x', 'x.pdf', 'application/pdf', 10, ${'a'.repeat(64)}, ${a.id})`).rejects.toMatchObject({ code: '23514' })
    expect(await others()).toEqual(data)

    await runMigrations(url, { log: quiet })
    expect((await objects()).tables).toBe(8)
    expect(await objects()).toEqual(before)
    expect(await sql`select count(*)::int as n from chat_messages`).toEqual([{ n: 0 }])
    expect(await others()).toEqual(data)
  })
})

describe('0039: employee notifications and secure files', () => {
  it('rolls back cleanly, leaves other data alone, and re-applies', async () => {
    const url = process.env.DATABASE_ADMIN_URL!
    const quiet = () => {}
    const objects = async () => (await adminSql()`select to_regclass('public.staff_notifications') as a, to_regclass('public.secure_files') as b,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and (p.proname like 'staff_notif%' or p.proname like '%secure_file%')) as fns,
      (select count(*)::int from pg_trigger where tgname like '%staff_notify') as triggers,
      (select count(*)::int from pg_policies where schemaname = 'public') as policies`)[0]
    // only columns that exist at 0039: later migrations add columns to tasks, and rolling back removes them
    const tasks = async () => (await adminSql()`select coalesce(md5(string_agg(concat_ws('|', t.id, t.org_id, t.title, t.status, t.assigned_to, t.created_by, t.due_date), ',' order by t.id)), '') as m from tasks t`)[0].m
    const before = await objects(); const data = await tasks()
    expect(before).toMatchObject({ a: 'staff_notifications', b: 'secure_files', triggers: 4 })
    expect(before.policies).toBeGreaterThan(149)
    await rollbackTo(url, '0039', quiet)
    expect(await objects()).toEqual({ a: null, b: null, fns: 0, triggers: 0, policies: 149 })
    expect(await tasks()).toBe(data)
    await runMigrations(url, { log: quiet })
    expect(await objects()).toEqual(before)
  })
})

describe('0038: passport rules become warning only', () => {
  const url = () => process.env.DATABASE_ADMIN_URL!
  const quiet = () => {}
  const NOTE = '[0038: warning only by MD decision, 4 Nov 2026]'
  const rule = async (name: string) => (await adminSql()`select enforcement, notes from passport_validity_rules where name = ${name}`)[0]
  const add = async (name: string, stage: string, university: string | null, notes: string | null) =>
    adminSql()`insert into passport_validity_rules (name, stage_key, min_months, enforcement, university_id, notes, is_active) values (${name}, ${stage}, 12, 'block', ${university}, ${notes}, false)`

  it('changes only rules the policy forbids, is audited, leaves data alone, and rolls back exactly', async () => {
    const [{ id: uni }] = await adminSql()`select id from universities where name = 'Medical University – Varna'`
    const INSTALLED = 'Passport valid for at least 12 months (all destinations)'
    await rollbackTo(url(), '0038', quiet)
    // as an existing database stands before 0038
    await adminSql()`update passport_validity_rules set enforcement = 'block', notes = 'Original note' where name = ${INSTALLED}`
    await add('T38 university after registration', 'university_application', uni, 'Official source')
    await add('T38 university at registration', 'registration', uni, null)
    await add('T38 country only', 'visa_processing', null, null)
    const students = (await adminSql()`select count(*)::int as n, coalesce(md5(string_agg(s::text, ',' order by s.id)), '') as m from students s`)[0]

    await runMigrations(url(), { log: quiet })
    expect(await rule(INSTALLED)).toEqual({ enforcement: 'warn', notes: `Original note ${NOTE}` })
    expect(await rule('T38 university after registration')).toEqual({ enforcement: 'block', notes: 'Official source' }) // a verified university rule stays
    expect(await rule('T38 university at registration')).toEqual({ enforcement: 'warn', notes: NOTE }) // Registration is always allowed
    expect(await rule('T38 country only')).toEqual({ enforcement: 'warn', notes: NOTE })
    const [{ n: audited }] = await adminSql()`select count(*)::int as n from audit_logs where entity_type = 'passport_validity_rules' and before_data ->> 'enforcement' = 'block' and after_data ->> 'enforcement' = 'warn'`
    expect(audited).toBeGreaterThanOrEqual(3)
    expect((await adminSql()`select count(*)::int as n, coalesce(md5(string_agg(s::text, ',' order by s.id)), '') as m from students s`)[0]).toEqual(students)

    await rollbackTo(url(), '0038', quiet)
    expect(await rule(INSTALLED)).toEqual({ enforcement: 'block', notes: 'Original note' })
    expect(await rule('T38 university at registration')).toEqual({ enforcement: 'block', notes: null })
    expect(await rule('T38 country only')).toEqual({ enforcement: 'block', notes: null })
    expect(await rule('T38 university after registration')).toEqual({ enforcement: 'block', notes: 'Official source' })

    await runMigrations(url(), { log: quiet })
    expect((await rule(INSTALLED)).enforcement).toBe('warn')
    await adminSql()`update passport_validity_rules set notes = null, is_active = true where name = ${INSTALLED}`
    await adminSql()`delete from passport_validity_rules where name like 'T38 %'`
  })
})

describe('migration safety', () => {
  it('functions re-created by later migrations stay closed to PUBLIC', async () => {
    const names = ['staff_notify', 'secure_file_can_read', 'secure_file_can_write', 'secure_file_upload_org', 'register_secure_file', 'authorize_secure_file_download', 'remove_secure_file', 'record_secure_file_scan', 'sf_org']
    const rows = await adminSql()`select p.proname, has_function_privilege('public', p.oid, 'execute') as pub from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = any(${names})`
    expect(rows.map((r) => r.proname).sort()).toEqual([...names].sort())
    expect(rows.filter((r) => r.pub)).toEqual([])
  })

  it('rolling back keeps archived accounts and submitted tasks as valid earlier states, and audits the change', async () => {
    const url = process.env.DATABASE_ADMIN_URL!; const quiet = () => {}; const sql = adminSql()
    const [org] = await sql`select id from organizations where code = 'EDX'`
    const [user] = await sql`select id from user_profiles where email = 'edx.counsellor2@demo.test'`
    const [t] = await sql`insert into tasks (org_id, title, assigned_to, created_by) values (${org.id}, 'Fictional rollback task', ${user.id}, ${user.id}) returning id`
    await sql`update tasks set status = 'submitted', submitted_at = now(), submitted_by = ${user.id} where id = ${t.id}`
    const [spare] = await sql`select u.id from user_profiles u where u.email = 'grd.finance@demo.test'`
    const [{ account_status: status }] = await sql`select account_status from user_profiles where id = ${spare.id}`
    await sql`update user_profiles set account_status = 'archived' where id = ${spare.id}`
    await rollbackTo(url, '0041', quiet)
    expect(await sql`select account_status from user_profiles where id = ${spare.id}`).toEqual([{ account_status: 'terminated' }])
    expect(await sql`select status from tasks where id = ${t.id}`).toEqual([{ status: 'in_progress' }])
    await runMigrations(url, { log: quiet })
    await sql`update user_profiles set account_status = ${status} where id = ${spare.id}`
    await sql`update tasks set status = 'cancelled' where id = ${t.id}`
  })

  it('every migration from 0017 on has a rollback script', () => {
    const files = readdirSync(path.resolve(import.meta.dirname, '../../db/migrations')).filter((f) => Number(f.slice(0, 4)) >= ROLLBACK_REQUIRED_FROM)
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) expect(existsSync(rollbackFileFor(f)), f).toBe(true)
  })

  it('rolling back the newest migrations and re-applying leaves the database consistent', async () => {
    const url = process.env.DATABASE_ADMIN_URL!
    const before = await adminSql()`select version from schema_migrations order by version`
    const quiet = () => {}
    await rollbackTo(url, String(ROLLBACK_REQUIRED_FROM).padStart(4, '0'), quiet)
    const mid = await adminSql()`select max(version) as v from schema_migrations`
    expect(Number(String(mid[0].v).slice(0, 4))).toBeLessThan(ROLLBACK_REQUIRED_FROM)
    await runMigrations(url, { log: quiet })
    const after = await adminSql()`select version from schema_migrations order by version`
    expect(after.map((r) => r.version)).toEqual(before.map((r) => r.version))
    // rollbacks remove configuration added by those migrations; re-provision (idempotent), as after a real rollback
    await provision(url, quiet)
    expect((await adminSql()`select count(*)::int as n from passport_validity_rules where is_active`)[0].n).toBeGreaterThan(0)
  })
})
