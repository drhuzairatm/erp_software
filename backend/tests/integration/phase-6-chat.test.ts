/** Phase 6: internal chat. Members only; no administrator access to private conversations. Fictional data. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ServiceError } from '@/lib/errors'
import * as chat from '@/services/chat'
import * as meetings from '@/services/meetings'
import * as secure from '@/services/secure-files'
import * as tasks from '@/services/tasks'
import { adminSql, as, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string; let GRD: string
const A = 'edx.counsellor@demo.test'; const B = 'edx.counsellor2@demo.test'; const MGR = 'edx.manager@demo.test'; const MD = 'md@demo.test'; const SA = 'admin@demo.test'; const G = 'grd.counsellor@demo.test'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
const pdf = () => new File([new TextEncoder().encode(`%PDF-1.4\n% ${rand()}\n%%EOF`)], 'shared.pdf', { type: 'application/pdf' })
async function refuses(p: Promise<unknown>, text?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (text) expect(`${(e as ServiceError).kind} ${(e as ServiceError).message}`).toContain(text); return }
  throw new Error('expected a refusal')
}
const dm = async () => chat.openDirect(await ctxFor(A), EDX, await userId(B))
const sync = async (who: string, c: string, extra = {}) => chat.chatSync(await ctxFor(who), { conversationId: c, ...extra })
beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql().end() })

describe('one-to-one', () => {
  it('reopening gives the same conversation from either side; the other company is refused', async () => {
    const c = await dm()
    expect(await chat.openDirect(await ctxFor(B), EDX, await userId(A))).toBe(c)
    await refuses(chat.openDirect(await ctxFor(A), EDX, await userId(G)), 'active member')
    await refuses(chat.openDirect(await ctxFor(A), GRD, await userId(G)), 'forbidden')
    await refuses(chat.openDirect(await ctxFor(A), EDX, await userId(A)), 'someone else')
  })

  it('the other person receives it, with unread count, delivery and read marks; notification text has no message content', async () => {
    const c = await dm(); const text = `Fictional secret ${rand()}`
    await sync(B, c, { read: true })
    await chat.sendMessage(await ctxFor(A), c, { body: text })
    const seenByA = (await sync(A, c)).messages.at(-1)!
    expect(seenByA).toMatchObject({ body: text, read: 0 })
    const unread = (await chat.listConversations(await ctxFor(B))).find((x) => x.id === c)!
    expect(unread.unread).toBeGreaterThan(0)
    expect(await chat.chatUnreadCount(await ctxFor(B))).toBeGreaterThan(0)
    const [n] = await adminSql()`select title from staff_notifications where user_id = ${await userId(B)} and subject_id = ${c} and event_key = 'chat_message' order by created_at desc limit 1`
    expect(n.title).not.toContain('secret')
    await sync(B, c) // delivered, not read
    expect((await sync(A, c)).messages.at(-1)).toMatchObject({ delivered: 1, read: 0 })
    await sync(B, c, { read: true })
    expect((await sync(A, c)).messages.at(-1)).toMatchObject({ read: 1 })
    expect((await chat.listConversations(await ctxFor(B))).find((x) => x.id === c)!.unread).toBe(0)
    const [m] = await adminSql()`select count(*)::int as n from audit_logs where after_data::text like ${'%' + text + '%'}`
    expect(m.n).toBe(0)
  })

  it('no administrator, MD, colleague or other company can read it, by any route', async () => {
    const c = await dm(); const text = `Private ${rand()}`
    await chat.sendMessage(await ctxFor(A), c, { body: text })
    for (const who of [MD, SA, MGR, G]) {
      await expect(as(who, (tx) => tx`select id from chat_messages where conversation_id = ${c}`)).resolves.toEqual([])
      await expect(as(who, (tx) => tx`select id from chat_conversations where id = ${c}`)).resolves.toEqual([])
      await refuses(sync(who, c), 'forbidden')
      expect((await chat.searchChat(await ctxFor(who), text)).length).toBe(0)
    }
    await refuses(chat.sendMessage(await ctxFor(MD), c, { body: 'Intruding' }), 'forbidden')
    await expectDbError(as(A, (tx) => tx`select * from chat_message_history`), '42501')
    await expectDbError(as(A, (tx) => tx`update chat_messages set body = 'changed' where conversation_id = ${c}`), '42501')
    await expectDbError(as(A, (tx) => tx`insert into chat_members (conversation_id, user_id, org_id) values (${c}, ${EDX}, ${EDX})`), '42501')
    expect((await chat.searchChat(await ctxFor(A), text)).length).toBe(1)
  })
})

describe('messages', () => {
  it('reply, edit with history, delete leaves a tombstone, react and pin', async () => {
    const c = await dm(); const a = await ctxFor(A); const b = await ctxFor(B)
    const first = await chat.sendMessage(a, c, { body: 'Original fictional text' })
    const second = await chat.sendMessage(b, c, { body: 'A fictional reply', replyTo: first })
    expect((await sync(A, c)).messages.find((m) => m.id === second)).toMatchObject({ reply_to_id: first, reply_preview: 'Original fictional text' })
    await refuses(chat.editMessage(b, first, 'Hijack'), 'forbidden')
    await chat.editMessage(a, first, 'Edited fictional text')
    expect((await sync(A, c)).messages.find((m) => m.id === first)?.edited_at).toBeTruthy()
    const [h] = await adminSql()`select previous_body, action from chat_message_history where message_id = ${first}`
    expect(h).toEqual({ previous_body: 'Original fictional text', action: 'edited' })
    await chat.reactToMessage(b, first, '👍', true); await chat.reactToMessage(b, first, '👍', true)
    expect((await sync(B, c)).messages.find((m) => m.id === first)?.reactions).toEqual([{ emoji: '👍', count: 1, mine: true }])
    await chat.reactToMessage(b, first, '👍', false)
    await refuses(chat.reactToMessage(b, first, '💣', true) as Promise<void>)
    await chat.pinMessage(a, first, true)
    expect((await sync(B, c)).pinned[0].id).toBe(first)
    await refuses(chat.deleteMessage(b, first), 'forbidden')
    await chat.deleteMessage(a, first)
    const gone = (await sync(B, c)).messages.find((m) => m.id === first)!
    expect(gone.body).toBe(''); expect(gone.deleted_at).toBeTruthy()
    expect((await sync(B, c)).pinned.find((p) => p.id === first)).toBeUndefined()
    await refuses(chat.editMessage(a, first, 'Too late'))
    await refuses(chat.sendMessage(a, c, { body: '' }), 'Write a message')
  })

  it('forwarding needs access to the source and stays within the company', async () => {
    const c = await dm(); const a = await ctxFor(A)
    const m = await chat.sendMessage(a, c, { body: 'Forward me' })
    const other = await chat.openDirect(a, EDX, await userId(MGR))
    const f = await chat.sendMessage(a, other, { forwardFrom: m })
    expect((await sync(MGR, other)).messages.find((x) => x.id === f)).toMatchObject({ body: 'Forward me', forwarded: true })
    const mine = await chat.openDirect(await ctxFor(MGR), EDX, await userId(MD))
    await refuses(chat.sendMessage(await ctxFor(MGR), mine, { forwardFrom: m }), 'forbidden')
    const [dual] = await adminSql()`select id from organizations where code = 'GRD'`
    const grdDm = await chat.openDirect(await ctxFor(MD), dual.id, await userId(G))
    const mdEdx = await chat.openDirect(await ctxFor(MD), EDX, await userId(A))
    const src = await chat.sendMessage(await ctxFor(MD), mdEdx, { body: 'Company only' })
    await refuses(chat.sendMessage(await ctxFor(MD), grdDm, { forwardFrom: src }), 'another company')
  })

  it('attachments go through secure storage: members only; bad type refused; deleting closes the file', async () => {
    const c = await dm(); const a = await ctxFor(A)
    const m = await chat.sendMessage(a, c, { body: 'See file', file: pdf() })
    const f = (await sync(B, c)).messages.find((x) => x.id === m)!.files[0]
    expect(f.scan).toBe('not_scanned')
    expect(await secure.openSecureFile(await ctxFor(B), f.id)).toBeTruthy()
    for (const who of [MD, SA, MGR, G]) expect(await secure.openSecureFile(await ctxFor(who), f.id)).toBeNull()
    await expect(chat.sendMessage(a, c, { file: new File([new TextEncoder().encode('MZ not allowed')], 'x.exe') })).rejects.toThrow('Only PDF')
    expect((await sync(A, c)).messages.at(-1)?.id).toBe(m) // the empty message did not stay
    await chat.deleteMessage(a, m)
    expect(await secure.openSecureFile(await ctxFor(B), f.id)).toBeNull()
  })

  it('a task reference is checked against what the sender may read', async () => {
    const c = await dm(); const a = await ctxFor(A)
    const own = await tasks.createTask(await ctxFor(MGR), { orgId: EDX, title: `Discussion ${rand()}`, assignedTo: a.userId })
    const m = await chat.sendMessage(a, c, { body: 'About this task', taskId: own })
    expect((await sync(A, c)).messages.find((x) => x.id === m)?.task_id).toBe(own)
    const hidden = await tasks.createTask(await ctxFor(MGR), { orgId: EDX, title: `Hidden ${rand()}`, assignedTo: await userId(MGR) })
    await refuses(chat.sendMessage(a, c, { body: 'Peek', taskId: hidden }), 'forbidden')
  })

  it('pagination returns earlier messages', async () => {
    const c = await chat.openDirect(await ctxFor(MGR), EDX, await userId(B)); const m = await ctxFor(MGR)
    for (let i = 0; i < 52; i++) await chat.sendMessage(m, c, { body: `Number ${i}` })
    const page = await sync(MGR, c)
    expect(page.messages.length).toBe(50); expect(page.hasMore).toBe(true)
    const older = await chat.chatSync(m, { conversationId: c, before: new Date(page.messages[0].created_at).toISOString() })
    expect(older.messages.some((x) => x.body === 'Number 0')).toBe(true)
  })
})

describe('groups', () => {
  it('creating needs the permission; members must belong to the company; the admin manages membership; removal ends access', async () => {
    const mgr = await ctxFor(MGR); const a = await ctxFor(A); const b = await ctxFor(B)
    await refuses(chat.createGroup(a, { orgId: EDX, name: 'Not allowed', groupType: 'custom', members: [] }), 'forbidden')
    await refuses(chat.createGroup(mgr, { orgId: GRD, name: 'Other company', groupType: 'custom', members: [] }), 'forbidden')
    await refuses(chat.createGroup(mgr, { orgId: EDX, name: 'Wrong member', groupType: 'custom', members: [await userId(G)] }), 'active member')
    const c = await chat.createGroup(mgr, { orgId: EDX, name: 'Fictional sales', groupType: 'sales', members: [a.userId] })
    const m = await chat.sendMessage(mgr, c, { body: `Hello @${'Sneha'} team` })
    expect((await sync(A, c)).messages.find((x) => x.id === m)).toBeTruthy()
    await refuses(sync(B, c), 'forbidden')
    await refuses(chat.setGroupMember(a, c, b.userId, true), 'forbidden')
    await chat.setGroupMember(mgr, c, b.userId, true)
    expect((await sync(B, c)).messages.length).toBeGreaterThan(0)
    await chat.setGroupMember(mgr, c, b.userId, false)
    await refuses(sync(B, c), 'forbidden')
    await chat.setGroupMember(a, c, a.userId, false)
    await refuses(sync(A, c), 'forbidden')
    await refuses(chat.pinMessage(b, m, true))
    const [log] = await adminSql()`select count(*)::int as n from audit_logs where entity_id = ${c} and action in ('chat_member_added', 'chat_member_removed', 'chat_group_left')`
    expect(log.n).toBe(3)
    expect((await as(MD, (tx) => tx`select id from chat_conversations where id = ${c}`)).length).toBe(0)
  })

  it('All Employees and Core Team fill from the company list', async () => {
    const md = await ctxFor(MD)
    const all = await chat.createGroup(md, { orgId: EDX, name: 'Everyone', groupType: 'all_employees' })
    const [{ n }] = await adminSql()`select count(*)::int as n from organization_memberships m join user_profiles u on u.id = m.user_id and u.account_status = 'active' where m.org_id = ${EDX} and m.is_active`
    expect((await sync(MD, all)).members.length).toBe(n)
    await meetings.setCoreTeamMember(md, EDX, await userId(MGR), true)
    const core = await chat.createGroup(md, { orgId: EDX, name: 'Core', groupType: 'core_team' })
    expect((await sync(MD, core)).members.map((m) => m.user_id).sort()).toEqual([md.userId, await userId(MGR)].sort())
    await meetings.setCoreTeamMember(md, EDX, await userId(MGR), false)
    await chat.syncGroup(md, core)
    await refuses(sync(MGR, core), 'forbidden')
    await refuses(chat.syncGroup(await ctxFor(A), all), 'forbidden')
    await expect(chat.syncGroup(md, core)).resolves.toBeUndefined()
  })

  it('a mention notifies; an ordinary group message does not; typing and presence are visible to members', async () => {
    const mgr = await ctxFor(MGR); const a = await ctxFor(A)
    await adminSql()`update user_profiles set full_name = full_name where id = ${a.userId}`
    const [{ full_name }] = await adminSql()`select full_name from user_profiles where id = ${a.userId}`
    const c = await chat.createGroup(mgr, { orgId: EDX, name: 'Mentions', groupType: 'custom', members: [a.userId] })
    await chat.sendMessage(mgr, c, { body: 'Plain group message' })
    const count = async (e: string) => (await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${a.userId} and subject_id = ${c} and event_key = ${e}`)[0].n
    expect(await count('chat_mention')).toBe(0)
    await chat.sendMessage(mgr, c, { body: `Please check @${full_name}` })
    expect(await count('chat_mention')).toBe(1)
    await chat.chatSync(a, { conversationId: c, typing: true })
    const seen = await sync(MGR, c)
    expect(seen.typing).toEqual([full_name])
    expect(seen.members.find((m) => m.user_id === a.userId)?.online).toBe(true)
    await chat.chatSync(a, { conversationId: c, read: true })
    expect(await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${a.userId} and subject_id = ${c} and read_at is null`).toEqual([{ n: 0 }])
  })
})
