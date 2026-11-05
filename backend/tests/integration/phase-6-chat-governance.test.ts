/** Chat governance: no general access to private messages; retention only under an approved policy; holds; audited investigation access. Fictional data. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as chat from '@/services/chat'
import * as gov from '@/services/chat-governance'
import { adminSql, as, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string; let GRD: string
const A = 'edx.counsellor@demo.test'; const B = 'edx.counsellor2@demo.test'; const MGR = 'edx.manager@demo.test'; const MD = 'md@demo.test'; const SA = 'admin@demo.test'; const HR = 'docs@demo.test'; const READER = 'ceo@demo.test'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
async function refuses(p: Promise<unknown>, text?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (text) expect(`${(e as ServiceError).kind} ${(e as ServiceError).message}`).toContain(text); return }
  throw new Error('expected a refusal')
}
const tick = () => anonymous((tx) => tx<{ n: number }[]>`select app.chatgov_retention_tick() as n`).then(([x]) => x.n)
const dm = async () => chat.openDirect(await ctxFor(A), EDX, await userId(B))
const backdate = (id: string, days: number) => adminSql()`update chat_messages set created_at = now() - make_interval(days => ${days}) where id = ${id}`
const bodyOf = async (id: string) => (await adminSql()`select body, deleted_at from chat_messages where id = ${id}`)[0]
async function authorities() {
  const md = await ctxFor(MD)
  await gov.setDelegate(md, EDX, await userId(HR), 'requester', true, 'Fictional HR lead')
  await gov.setDelegate(md, EDX, await userId(READER), 'reader', true, 'Fictional legal reviewer')
}
const request = async (over: Record<string, unknown> = {}) => gov.createRequest(await ctxFor(HR), EDX, { reference: `CASE-${rand()}`, reason: 'A fictional formal complaint under review', user: await userId(A), user2: await userId(B), reader: await userId(READER), ...over } as never)

beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql()`update chatgov_retention_policies set purge_enabled = false`; await adminSql().end() })

describe('no general access', () => {
  it('edited and deleted text is kept, and no role can read it directly, including the MD', async () => {
    const c = await dm(); const a = await ctxFor(A); const text = `Original ${rand()}`
    const m = await chat.sendMessage(a, c, { body: text })
    await chat.editMessage(a, m, 'Edited text')
    await chat.deleteMessage(a, m)
    expect((await adminSql()`select action, previous_body from chat_message_history where message_id = ${m} order by acted_at`).map((r) => [r.action, r.previous_body])).toEqual([['edited', text], ['deleted', 'Edited text']])
    for (const who of [A, B, MD, SA, MGR, HR, READER]) await expectDbError(as(who, (tx) => tx`select * from chat_message_history`), '42501')
    expect((await chat.chatSync(a, { conversationId: c })).messages.find((x) => x.id === m)).toMatchObject({ body: '' })
  })

  it('administrators and managers cannot use any governance function or see any record', async () => {
    for (const who of [SA, MGR, A]) {
      const ctx = await ctxFor(who)
      expect(await gov.governanceAccess(ctx)).toEqual([])
      await refuses(gov.setRetention(ctx, EDX, { retentionDays: '10', purge: true, reference: 'Self approved' }), 'forbidden')
      await refuses(gov.setDelegate(ctx, EDX, ctx.userId, 'reader', true, 'Self grant'), 'forbidden')
      await refuses(gov.placeHold(ctx, EDX, { reference: 'CASE-X', reason: 'A fictional reason here', user: ctx.userId }), 'forbidden')
      await refuses(gov.createRequest(ctx, EDX, { reference: 'CASE-X', reason: 'A fictional reason here', user: ctx.userId, reader: ctx.userId }), 'forbidden')
      expect(await as(who, (tx) => tx`select id from chatgov_requests`)).toEqual([])
      expect(await as(who, (tx) => tx`select id from chatgov_access_log`)).toEqual([])
    }
  })

  it('a role cannot be given this access, because no permission grants it', async () => {
    expect(await adminSql()`select key from permissions where key like 'chatgov%' or key like 'chat.%' and key <> 'chat.groups.manage'`).toEqual([])
  })

  it('the MD of one company has no authority in a company they do not belong to, and the MD cannot read without a grant', async () => {
    const md = await ctxFor(MD)
    expect((await gov.governanceAccess(md)).map((g) => g.is_md)).toEqual([true, true])
    await authorities()
    const q = await request()
    await gov.decideRequest(md, q, true, 'Fictional approval', '5')
    await refuses(gov.readRequest(md, q), 'forbidden')
  })
})

describe('retention', () => {
  it('nothing happens without a policy, or with one that is not turned on', async () => {
    const c = await dm(); const m = await chat.sendMessage(await ctxFor(A), c, { body: 'Very old fictional text' })
    await backdate(m, 4000)
    await tick()
    expect((await bodyOf(m)).body).toBe('Very old fictional text')
    await gov.setRetention(await ctxFor(MD), EDX, { retentionDays: '30' })
    await tick()
    expect((await bodyOf(m)).body).toBe('Very old fictional text')
    await refuses(gov.setRetention(await ctxFor(MD), EDX, { purge: true, reference: 'POL-1' }), 'retention period')
    await refuses(gov.setRetention(await ctxFor(MD), EDX, { retentionDays: '30', purge: true }), 'reference')
  })

  it('an approved policy archives old messages, skips those under a hold, and the archive job respects holds', async () => {
    const md = await ctxFor(MD); const c = await dm(); const a = await ctxFor(A)
    const old = await chat.sendMessage(a, c, { body: 'Old message to archive' }); const recent = await chat.sendMessage(a, c, { body: 'Recent message' })
    await backdate(old, 40)
    const hold = await gov.placeHold(md, EDX, { reference: `HOLD-${rand()}`, reason: 'A fictional formal investigation', user: a.userId })
    await gov.setRetention(md, EDX, { retentionDays: '30', archiveDays: '60', purge: true, reference: 'POL-FICTIONAL-1' })
    await tick()
    expect((await bodyOf(old)).body).toBe('Old message to archive') // held
    const [run] = await adminSql()`select held_skipped from chatgov_retention_runs where org_id = ${EDX} order by ran_at desc limit 1`
    expect(run.held_skipped).toBeGreaterThan(0)

    await gov.releaseHold(md, hold, 'Fictional case closed')
    await tick()
    expect(await bodyOf(old)).toMatchObject({ body: '' })
    expect((await bodyOf(recent)).body).toBe('Recent message')
    const arch = await adminSql()`select id, action, previous_body from chat_message_history where message_id = ${old}`
    expect(arch).toMatchObject([{ action: 'retention_archived', previous_body: 'Old message to archive' }])

    // the archive period passes: a hold still protects it, and only the job can erase it
    const sql = adminSql()
    await sql`alter table chat_message_history disable trigger chat_message_history_guard`
    await sql`update chat_message_history set acted_at = now() - interval '61 days' where id = ${arch[0].id}`
    await sql`alter table chat_message_history enable trigger chat_message_history_guard`
    const hold2 = await gov.placeHold(md, EDX, { reference: `HOLD-${rand()}`, reason: 'A second fictional investigation' })
    await tick()
    expect((await sql`select id from chat_message_history where id = ${arch[0].id}`).length).toBe(1)
    await gov.releaseHold(md, hold2, 'Fictional case closed')
    await tick()
    expect((await sql`select id from chat_message_history where id = ${arch[0].id}`).length).toBe(0)
    await gov.setRetention(md, EDX, {})
    expect((await sql`select count(*)::int as n from audit_logs where action = 'chat_retention_run' and metadata::text like '%Old message%'`)[0].n).toBe(0)
  })

  it('the archive and logs refuse change, even for a full-rights connection', async () => {
    const c = await dm(); const a = await ctxFor(A); const m = await chat.sendMessage(a, c, { body: 'Keep me' })
    await chat.editMessage(a, m, 'Kept')
    await expect(adminSql()`update chat_message_history set previous_body = 'tampered' where message_id = ${m}`).rejects.toMatchObject({ code: '42501' })
    await expect(adminSql()`delete from chat_message_history where message_id = ${m}`).rejects.toMatchObject({ code: '42501' })
  })

  it('the retention job is for the system only', async () => {
    await expectDbError(as(MD, (tx) => tx`select app.chatgov_retention_tick()`), '42501')
  })
})

describe('investigation access', () => {
  it('runs from request to approval to a logged read, with versions and deleted text, for the named reader only', async () => {
    const c = await dm(); const a = await ctxFor(A); const md = await ctxFor(MD); const reader = await ctxFor(READER); const before = `Before ${rand()}`
    const m = await chat.sendMessage(a, c, { body: before })
    await chat.editMessage(a, m, `After ${rand()}`); await chat.deleteMessage(a, m)
    await authorities()
    const q = await request()

    await refuses(gov.readRequest(reader, q), 'forbidden') // not approved yet
    await refuses(gov.decideRequest(await ctxFor(HR), q, true, 'Self approval', '5'), 'forbidden')
    await refuses(gov.decideRequest(md, q, true, 'No period', ''), 'days')
    await refuses(gov.decideRequest(md, q, true, 'Too long', '31'), 'days')
    await gov.decideRequest(md, q, true, 'Fictional approval by the MD', '5')
    await refuses(gov.decideRequest(md, q, false, 'Again', ''), 'already')

    const d = await gov.readRequest(reader, q)
    const row = d.messages.find((x) => x.id === m)!
    expect(row.history.map((h) => h.action)).toEqual(['edited', 'deleted'])
    expect(row.history[0].body).toBe(before)

    const [log] = await adminSql()`select accessor_id, message_ids, accessed_at from chatgov_access_log where request_id = ${q} order by accessed_at desc limit 1`
    expect(log.accessor_id).toBe(reader.userId); expect(log.message_ids).toContain(m)
    const [r] = await adminSql()`select reason, requested_by, decided_by, reader_id from chatgov_requests where id = ${q}`
    expect(r).toMatchObject({ requested_by: await userId(HR), decided_by: md.userId, reader_id: reader.userId })
    expect(r.reason).toContain('fictional')
    await expect(adminSql()`update chatgov_access_log set message_ids = '{}' where request_id = ${q}`).rejects.toMatchObject({ code: '42501' })
    await expect(adminSql()`delete from chatgov_access_log where request_id = ${q}`).rejects.toMatchObject({ code: '42501' })
    await expect(adminSql()`delete from chatgov_requests where id = ${q}`).rejects.toMatchObject({ code: '42501' })
    await expectDbError(as(READER, (tx) => tx`insert into chatgov_access_log (request_id, org_id, accessor_id, message_ids) values (${q}, ${EDX}, ${reader.userId}, '{}')`), '42501')

    for (const who of [A, B, HR, MGR, SA, MD]) await refuses(gov.readRequest(await ctxFor(who), q), 'forbidden')
    expect((await adminSql()`select count(*)::int as n from audit_logs where entity_id = ${q} and action = 'chat_investigation_read' and (coalesce(after_data::text, '') || coalesce(metadata::text, '')) like ${'%' + before + '%'}`)[0].n).toBe(0)
    expect((await adminSql()`select count(*)::int as n from audit_logs where entity_id = ${q} and action = 'chat_investigation_read'`)[0].n).toBe(1)
  })

  it('access ends when it expires, when the request closes, or when the reader loses the grant', async () => {
    await dm(); await authorities(); const md = await ctxFor(MD); const reader = await ctxFor(READER)
    const q = await request(); await gov.decideRequest(md, q, true, 'Fictional approval', '5')
    await adminSql()`update chatgov_requests set expires_at = now() - interval '1 minute' where id = ${q}`
    await refuses(gov.readRequest(reader, q), 'forbidden')
    const q2 = await request(); await gov.decideRequest(md, q2, true, 'Fictional approval', '5')
    await gov.closeRequest(reader, q2)
    await refuses(gov.readRequest(reader, q2), 'forbidden')
    const q3 = await request(); await gov.decideRequest(md, q3, true, 'Fictional approval', '5')
    await gov.setDelegate(md, EDX, reader.userId, 'reader', false, '')
    await refuses(gov.readRequest(reader, q3), 'forbidden')
    await authorities()
    const q4 = await request(); await gov.decideRequest(md, q4, false, 'Fictional refusal', '')
    await refuses(gov.readRequest(reader, q4), 'forbidden')
  })

  it('nobody decides or reads a case about their own messages; the approver is never the reader', async () => {
    const md = await ctxFor(MD); await authorities()
    await chat.openDirect(md, EDX, await userId(A))
    const aboutMd = await request({ user: md.userId, user2: await userId(A) })
    await refuses(gov.decideRequest(md, aboutMd, true, 'My own messages', '5'), 'forbidden')
    await refuses(request({ user: await userId(READER), user2: undefined }), 'cannot be a person under review')
    await refuses(request({ reader: await userId(MGR) }), 'named as a reader')
    await gov.setDelegate(md, EDX, md.userId, 'reader', true, 'Fictional self grant for this test')
    const q = await request({ reader: md.userId })
    await refuses(gov.decideRequest(md, q, true, 'Reading my own approval', '5'), 'forbidden')
    await gov.setDelegate(md, EDX, md.userId, 'reader', false, '')
    await gov.closeRequest(md, q)
  })

  it('a named approver can authorise instead of the MD', async () => {
    const md = await ctxFor(MD); await authorities()
    await gov.setDelegate(md, EDX, await userId(MGR), 'approver', true, 'Fictional designated authority')
    const q = await gov.createRequest(md, EDX, { reference: `CASE-${rand()}`, reason: 'A fictional request from the MD', user: await userId(A), reader: await userId(READER) })
    await refuses(gov.decideRequest(md, q, true, 'My own request', '5'), 'forbidden')
    await gov.decideRequest(await ctxFor(MGR), q, true, 'Fictional approval by the named authority', '3')
    expect((await gov.readRequest(await ctxFor(READER), q)).total).toBeGreaterThan(0)
    await gov.setDelegate(md, EDX, await userId(MGR), 'approver', false, '')
    await refuses(gov.placeHold(await ctxFor(MGR), EDX, { reference: 'HOLD-X', reason: 'No longer authorised' }), 'forbidden')
  })

  it('company isolation: a grant in one company means nothing in another', async () => {
    await authorities()
    await refuses(gov.createRequest(await ctxFor(HR), GRD, { reference: 'CASE-G', reason: 'A fictional cross company request', user: await userId('grd.counsellor@demo.test'), reader: await userId(READER) }), 'forbidden')
    const q = await request()
    expect(await as('grd.manager@demo.test', (tx) => tx`select id from chatgov_requests where id = ${q}`)).toEqual([])
    await gov.closeRequest(await ctxFor(HR), q)
  })
})
