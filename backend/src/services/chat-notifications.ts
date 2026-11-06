import { createHash } from 'node:crypto'
import { invalid } from '../lib/errors'
import { type Ctx, run } from './base'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CONVERSATIONS = 20

export interface ChatAlertSettings { inApp: boolean; sound: boolean; desktopPreview: boolean }
export interface UnreadConversation {
  id: string; kind: string; title: string | null; orgName: string; unread: number; muted: boolean
  latest: { id: string; at: string; sender: string; preview: string }
}
export interface ChatNotificationState {
  signedIn: true; serverTime: string; total: number; sig: string; settings: ChatAlertSettings; conversations: UnreadConversation[]
}

const defaults: ChatAlertSettings = { inApp: true, sound: false, desktopPreview: false }

/**
 * What the person's one shared poller asks for. Every table is read through row-level security as this person, so only
 * conversations they are an active member of can appear. On other pages it reads only: no presence, delivery or read state
 * changes. With the Chat page open it also records online and delivered, as that page always has; it never marks anything read.
 */
export async function chatNotificationState(ctx: Ctx, opts: { onChatPage?: boolean } = {}): Promise<ChatNotificationState> {
  return run(ctx, async (tx) => {
    if (opts.onChatPage) await tx`select app.chat_heartbeat(null, false, false)`
    const rows = await tx<{ id: string; kind: string; name: string | null; org_name: string; muted: boolean; unread: number; last_at: string | null; latest_id: string | null; latest_at: string | null; sender: string | null; body: string | null }[]>`
      select me.conversation_id as id, c.kind, c.name, o.name as org_name,
             exists (select 1 from chat_conversation_mutes x where x.conversation_id = me.conversation_id and x.user_id = ${ctx.userId}) as muted,
             (select count(*)::int from chat_messages m where m.conversation_id = me.conversation_id and m.created_at > me.last_read_at and m.sender_id <> ${ctx.userId} and m.deleted_at is null) as unread,
             (select max(m.created_at)::text from chat_messages m where m.conversation_id = me.conversation_id) as last_at,
             l.id as latest_id, to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_at, l.sender, l.body
        from chat_members me join chat_conversations c on c.id = me.conversation_id join organizations o on o.id = c.org_id
        left join lateral (
          select m.id, m.created_at, m.body, s.full_name as sender from chat_messages m left join user_profiles s on s.id = m.sender_id
           where m.conversation_id = me.conversation_id and m.created_at > me.last_read_at and m.sender_id <> ${ctx.userId} and m.deleted_at is null
           order by m.created_at desc, m.id desc limit 1) l on true
       where me.user_id = ${ctx.userId} and me.left_at is null
       order by l.created_at desc nulls last`
    const [s] = await tx<{ in_app: boolean; sound: boolean; desktop_preview: boolean }[]>`select in_app, sound, desktop_preview from chat_notification_settings where user_id = ${ctx.userId}`
    const [{ now }] = await tx<{ now: string }[]>`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now`
    const unread = rows.filter((r) => r.unread > 0 && r.latest_id)
    return {
      signedIn: true as const,
      serverTime: now,
      total: unread.filter((r) => !r.muted).reduce((n, r) => n + r.unread, 0),
      // Tells the Chat page when its list changed, without sending the list on every poll.
      sig: createHash('sha256').update(rows.map((r) => `${r.id}:${r.unread}:${r.last_at}:${r.muted}`).sort().join('|')).digest('base64url').slice(0, 22),
      settings: s ? { inApp: s.in_app, sound: s.sound, desktopPreview: s.desktop_preview } : defaults,
      conversations: unread.slice(0, MAX_CONVERSATIONS).map((r) => ({
        id: r.id, kind: r.kind, title: r.name, orgName: r.org_name, unread: r.unread, muted: r.muted,
        latest: { id: r.latest_id!, at: r.latest_at!, sender: r.sender ?? 'A colleague', preview: previewOf(r.body) },
      })),
    }
  })
}

export function previewOf(body: string | null) {
  const text = (body ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return 'Sent a file'
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

export async function myChatAlertSettings(ctx: Ctx): Promise<ChatAlertSettings> {
  const [s] = await run(ctx, (tx) => tx<{ in_app: boolean; sound: boolean; desktop_preview: boolean }[]>`select in_app, sound, desktop_preview from chat_notification_settings where user_id = ${ctx.userId}`)
  return s ? { inApp: s.in_app, sound: s.sound, desktopPreview: s.desktop_preview } : defaults
}

export async function saveChatAlertSettings(ctx: Ctx, v: ChatAlertSettings) {
  await run(ctx, (tx) => tx`select app.chat_save_notification_settings(${v.inApp}, ${v.sound}, ${v.desktopPreview})`)
}

/** Mutes alerts for this person only. The database refuses anyone who is not a member of the conversation. */
export async function setConversationMute(ctx: Ctx, conversationId: string, muted: boolean) {
  if (!UUID_RE.test(conversationId)) throw invalid('Not found.')
  await run(ctx, (tx) => tx`select app.chat_set_mute(${conversationId}, ${muted})`)
}

export async function myMutedConversations(ctx: Ctx) {
  return run(ctx, (tx) => tx<{ id: string; title: string }[]>`
    select c.id, coalesce(c.name, ou.full_name, 'Conversation') as title
      from chat_conversation_mutes x join chat_members me on me.conversation_id = x.conversation_id and me.user_id = x.user_id and me.left_at is null
      join chat_conversations c on c.id = x.conversation_id
      left join chat_members other on c.kind = 'direct' and other.conversation_id = c.id and other.user_id <> x.user_id
      left join user_profiles ou on ou.id = other.user_id
     where x.user_id = ${ctx.userId} order by 2`)
}
