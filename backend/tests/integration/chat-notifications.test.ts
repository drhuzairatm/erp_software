/** Global chat notifications: who may receive what. Runs as each person through row-level security. Fictional data. */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as chat from '@/services/chat'
import { chatNotificationState, myChatAlertSettings, myMutedConversations, previewOf, saveChatAlertSettings, setConversationMute } from '@/services/chat-notifications'
import { adminSql, as, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string
const A = 'edx.counsellor@demo.test'; const B = 'edx.counsellor2@demo.test'; const MGR = 'edx.manager@demo.test'; const MD = 'md@demo.test'; const G = 'grd.counsellor@demo.test'
const text = () => `Fictional ${randomBytes(6).toString('hex')}`
const stateOf = async (who: string) => chatNotificationState(await ctxFor(who))
const entry = async (who: string, conv: string) => (await stateOf(who)).conversations.find((c) => c.id === conv)
const say = async (who: string, conv: string, body = text()) => { await chat.sendMessage(await ctxFor(who), conv, { body }); return body }
const dmWith = async (from: string, to: string) => chat.openDirect(await ctxFor(from), EDX, await userId(to))
const read = async (who: string, conv: string) => chat.chatSync(await ctxFor(who), { conversationId: conv, read: true })
const group = async (members: string[]) => chat.createGroup(await ctxFor(MGR), { orgId: EDX, name: `Fictional ${randomBytes(3).toString('hex')}`, groupType: 'custom', members: await Promise.all(members.map(userId)) })

beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end() })

describe('who is told', () => {
  it('staff to MD: the MD sees sender and preview without opening Chat', async () => {
    const c = await dmWith(A, MD); await read(MD, c)
    const body = await say(A, c)
    const e = await entry(MD, c)
    expect(e).toMatchObject({ kind: 'direct', unread: 1, muted: false })
    expect(e!.latest.preview).toBe(body)
    expect((await entry(A, c))).toBeUndefined() // never for your own message
  })

  it('MD to staff', async () => {
    const c = await dmWith(MD, A); await read(A, c)
    await say(MD, c)
    expect((await entry(A, c))?.unread).toBe(1)
  })

  it('a group message reaches every member and nobody else', async () => {
    const c = await group([A, B])
    await read(A, c); await read(B, c)
    const body = await say(MGR, c)
    expect((await entry(A, c))?.latest.preview).toBe(body)
    expect((await entry(B, c))?.latest.preview).toBe(body)
    expect((await entry(MGR, c))).toBeUndefined()
    expect(JSON.stringify(await stateOf(MD))).not.toContain(body)
  })

  it('the MD and a manager are told nothing about a private conversation between two others', async () => {
    const c = await dmWith(A, B); const body = await say(A, c)
    for (const who of [MD, MGR, G]) {
      const s = await stateOf(who)
      expect(s.conversations.some((x) => x.id === c)).toBe(false)
      expect(JSON.stringify(s)).not.toContain(body)
    }
  })

  it('another company receives nothing, and cannot mute or read a conversation it is not in', async () => {
    const c = await dmWith(A, B); await say(A, c)
    const other = await ctxFor(G)
    expect((await stateOf(G)).conversations.some((x) => x.id === c)).toBe(false)
    await expect(setConversationMute(other, c, true)).rejects.toBeInstanceOf(ServiceError)
    await expect(chat.chatSync(other, { conversationId: c })).rejects.toBeInstanceOf(ServiceError)
    expect(await as(G, (tx) => tx`select id from chat_messages where conversation_id = ${c}`)).toHaveLength(0)
  })

  it('someone removed from a group stops being told at once, including about older unread messages', async () => {
    const c = await group([A, B]); await read(B, c)
    await say(A, c)
    expect((await entry(B, c))?.unread).toBe(1)
    await chat.setGroupMember(await ctxFor(MGR), c, await userId(B), false)
    expect(await entry(B, c)).toBeUndefined()
  })

  it('someone whose company access ends stops being told', async () => {
    const c = await dmWith(A, B); await read(B, c); await say(A, c)
    expect((await entry(B, c))?.unread).toBe(1)
    const b = await userId(B)
    await adminSql()`update organization_memberships set is_active = false where user_id = ${b} and org_id = ${EDX}`
    try {
      const s = await stateOf(B)
      expect(s.conversations.some((x) => x.id === c)).toBe(false)
    } finally {
      await adminSql()`update organization_memberships set is_active = true where user_id = ${b} and org_id = ${EDX}`
    }
  })
})

describe('counts and read state', () => {
  it('polling changes nothing: not read, delivered or online', async () => {
    const c = await dmWith(A, B); await read(B, c); await say(A, c)
    const b = await userId(B)
    const snap = async () => (await adminSql()`select m.last_read_at, m.last_delivered_at, p.last_seen_at from chat_members m left join chat_presence p on p.user_id = m.user_id where m.conversation_id = ${c} and m.user_id = ${b}`)[0]
    const before = await snap()
    await stateOf(B); await stateOf(B)
    expect(await snap()).toEqual(before)
    expect((await entry(B, c))?.unread).toBe(1)
  })

  it('with the Chat page open it records online and delivered, but never read', async () => {
    const c = await dmWith(A, B); await read(B, c); await say(A, c)
    await chatNotificationState(await ctxFor(B), { onChatPage: true })
    const [m] = await adminSql()`select m.last_read_at, m.last_delivered_at, (select max(created_at) from chat_messages where conversation_id = ${c}) as sent from chat_members m where m.conversation_id = ${c} and m.user_id = ${await userId(B)}`
    expect((m.last_delivered_at as Date).getTime()).toBeGreaterThanOrEqual((m.sent as Date).getTime())
    expect((m.last_read_at as Date).getTime()).toBeLessThan((m.sent as Date).getTime())
    expect((await entry(B, c))?.unread).toBe(1)
  })

  it('counts several messages and conversations, and opening one clears only that one', async () => {
    const c1 = await dmWith(A, B); const c2 = await dmWith(MD, B); await read(B, c1); await read(B, c2)
    const start = (await stateOf(B)).total
    await say(A, c1); await say(A, c1); await say(MD, c2)
    const s = await stateOf(B)
    expect(s.total).toBe(start + 3)
    expect(s.conversations.find((x) => x.id === c1)?.unread).toBe(2)
    await read(B, c1)
    const after = await stateOf(B)
    expect(after.total).toBe(start + 1)
    expect(after.conversations.some((x) => x.id === c1)).toBe(false)
    expect(after.conversations.find((x) => x.id === c2)?.unread).toBe(1)
  })

  it('a deleted message is not previewed or counted', async () => {
    const c = await dmWith(A, B); await read(B, c)
    const body = await say(A, c)
    const [m] = await adminSql()`select id from chat_messages where conversation_id = ${c} and body = ${body}`
    await chat.deleteMessage(await ctxFor(A), m.id as string)
    expect(await entry(B, c)).toBeUndefined()
    expect(JSON.stringify(await stateOf(B))).not.toContain(body)
  })

  it('the list signature changes when the list does, and previews stay short', async () => {
    const c = await dmWith(A, B); await read(B, c)
    const before = (await stateOf(B)).sig
    await say(A, c)
    expect((await stateOf(B)).sig).not.toBe(before)
    expect(previewOf(`a\n\n${'b'.repeat(200)}`).length).toBe(80)
    expect(previewOf('   ')).toBe('Sent a file')
  })
})

describe('settings', () => {
  it('muting is personal: no alert or badge for that person, the member stays a member, and others are unaffected', async () => {
    const c = await group([A, B]); await read(A, c); await read(B, c)
    const a = await ctxFor(A)
    await setConversationMute(a, c, true)
    await say(MGR, c)
    const s = await stateOf(A)
    expect(s.conversations.find((x) => x.id === c)).toMatchObject({ muted: true, unread: 1 })
    expect(s.total).toBe(s.conversations.filter((x) => !x.muted).reduce((n, x) => n + x.unread, 0))
    expect((await entry(B, c))?.muted).toBe(false)
    expect((await myMutedConversations(a)).some((x) => x.id === c)).toBe(true)
    expect(await as(B, (tx) => tx`select user_id from chat_conversation_mutes where conversation_id = ${c}`)).toHaveLength(0) // nobody can see who muted
    await setConversationMute(a, c, false)
    expect((await entry(A, c))?.muted).toBe(false)
  })

  it('sensible defaults, saved per person, and written only through the function', async () => {
    const mgr = await ctxFor(MGR)
    expect(await myChatAlertSettings(mgr)).toEqual({ inApp: true, sound: false, desktopPreview: false })
    await saveChatAlertSettings(mgr, { inApp: false, sound: true, desktopPreview: true })
    expect((await stateOf(MGR)).settings).toEqual({ inApp: false, sound: true, desktopPreview: true })
    expect((await stateOf(A)).settings.inApp).toBe(true)
    const aId = await userId(A)
    expect(await as(A, (tx) => tx`select user_id from chat_notification_settings where user_id <> ${aId}`)).toHaveLength(0)
    await expectDbError(as(A, (tx) => tx`insert into chat_notification_settings (user_id) values (${mgr.userId})`), '42501')
    await saveChatAlertSettings(mgr, { inApp: true, sound: false, desktopPreview: false })
  })
})

describe('background polling and the idle limit', () => {
  const session = async (seen: string, expires = "now() + interval '1 day'") => {
    const hash = randomBytes(32).toString('hex')
    await adminSql().unsafe(`insert into auth_private.sessions (user_id, token_hash, last_seen_at, expires_at) values ('${await userId(A)}', '${hash}', ${seen}, ${expires})`)
    return hash
  }
  const seen = async (hash: string) => (await adminSql()`select last_seen_at from auth_private.sessions where token_hash = ${hash}`)[0].last_seen_at as Date
  const peek = (hash: string) => anonymous((tx) => tx`select * from app.auth_peek_session(${hash})`)

  it('a poll does not count as activity; a normal request still does', async () => {
    const hash = await session("now() - interval '2 hours'")
    const before = await seen(hash)
    expect(await peek(hash)).toHaveLength(1)
    expect(await seen(hash)).toEqual(before)
    await anonymous((tx) => tx`select * from app.auth_resolve_session(${hash})`)
    expect((await seen(hash)).getTime()).toBeGreaterThan(before.getTime())
  })

  it('refuses a session past the idle limit, expired or revoked, like the normal check', async () => {
    expect(await peek(await session("now() - interval '9 hours'"))).toHaveLength(0)
    expect(await peek(await session('now()', "now() - interval '1 minute'"))).toHaveLength(0)
    const revoked = await session('now()')
    await adminSql()`update auth_private.sessions set revoked_at = now() where token_hash = ${revoked}`
    expect(await peek(revoked)).toHaveLength(0)
  })
})
