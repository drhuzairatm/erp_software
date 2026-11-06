import { can } from '../lib/auth/context'
import { forbidden, invalid, notFound } from '../lib/errors'
import { MAX_UPLOAD_BYTES, sniffMime } from '../lib/storage'
import { uploadSecureFile } from './secure-files'
import { type Ctx, run } from './base'

/** Internal chat. Row-level security allows members only; no role reads a conversation it is not part of. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE = 50
export const REACTIONS = ['👍', '❤️', '😂', '🎉', '✅', '🙏'] as const
export const GROUP_TYPES = [['custom', 'Custom group'], ['all_employees', 'All Employees'], ['core_team', 'Core Team'], ['sales', 'Sales'], ['marketing', 'Marketing'], ['management', 'Management']] as const
const ONLINE_SECONDS = 45

export interface ConversationRow { id: string; org_id: string; org_name: string; kind: string; name: string | null; group_type: string | null; other_id: string | null; other_name: string | null; other_online: boolean; role: string; unread: number; last_at: Date | null; last_preview: string | null; photo_version: number | null; muted: boolean }
export interface ChatMessage { id: string; sender_id: string; sender_name: string; sender_photo: number | null; body: string; reply_to_id: string | null; reply_preview: string | null; reply_sender: string | null; forwarded: boolean; task_id: string | null; task_title: string | null; created_at: Date; edited_at: Date | null; deleted_at: Date | null; pinned_at: Date | null; reactions: { emoji: string; count: number; mine: boolean }[]; files: { id: string; name: string; scan: string; mime: string }[]; delivered: number; read: number }

export async function listConversations(ctx: Ctx) {
  return run(ctx, (tx) => tx<ConversationRow[]>`
    select c.id, c.org_id, o.name as org_name, c.kind, c.name, c.group_type, me.role,
           other.user_id as other_id, ou.full_name as other_name,
           coalesce(pr.last_seen_at > now() - make_interval(secs => ${ONLINE_SECONDS}), false) as other_online,
           (select p.version from staff_photos p where p.user_id = other.user_id and p.is_current) as photo_version,
           (select count(*)::int from chat_messages m where m.conversation_id = c.id and m.created_at > me.last_read_at and m.sender_id <> ${ctx.userId} and m.deleted_at is null) as unread,
           last.created_at as last_at, left(last.body, 80) as last_preview,
           exists (select 1 from chat_conversation_mutes x where x.conversation_id = c.id and x.user_id = ${ctx.userId}) as muted
      from chat_members me join chat_conversations c on c.id = me.conversation_id join organizations o on o.id = c.org_id
      left join chat_members other on c.kind = 'direct' and other.conversation_id = c.id and other.user_id <> ${ctx.userId}
      left join user_profiles ou on ou.id = other.user_id
      left join chat_presence pr on pr.user_id = other.user_id
      left join lateral (select m.body, m.created_at from chat_messages m where m.conversation_id = c.id and m.deleted_at is null order by m.created_at desc limit 1) last on true
     where me.user_id = ${ctx.userId} and me.left_at is null
     order by coalesce(last.created_at, c.created_at) desc limit 200`)
}

async function messagesOf(ctx: Ctx, tx: Parameters<Parameters<typeof run>[1]>[0], id: string, before?: string) {
  const beforeCond = before && !Number.isNaN(Date.parse(before)) ? tx`and m.created_at < ${new Date(before)}` : tx``
  const rows = await tx<ChatMessage[]>`
    select m.id, m.sender_id, u.full_name as sender_name, (select p.version from staff_photos p where p.user_id = m.sender_id and p.is_current) as sender_photo,
           m.body, m.reply_to_id, left(r.body, 80) as reply_preview, ru.full_name as reply_sender, m.forwarded, m.task_id, t.title as task_title, m.created_at, m.edited_at, m.deleted_at, m.pinned_at,
           coalesce((select jsonb_agg(jsonb_build_object('emoji', e.emoji, 'count', e.n, 'mine', e.mine)) from (select x.emoji, count(*)::int as n, bool_or(x.user_id = ${ctx.userId}) as mine from chat_reactions x where x.message_id = m.id group by x.emoji) e), '[]') as reactions,
           coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.original_filename, 'scan', f.scan_status, 'mime', f.mime_type)) from secure_files f where f.context_type = 'chat' and f.context_id = m.id and f.removed_at is null), '[]') as files,
           (select count(*)::int from chat_members c where c.conversation_id = m.conversation_id and c.user_id <> m.sender_id and c.left_at is null and c.last_delivered_at >= m.created_at) as delivered,
           (select count(*)::int from chat_members c where c.conversation_id = m.conversation_id and c.user_id <> m.sender_id and c.left_at is null and c.last_read_at >= m.created_at) as read
      from chat_messages m join user_profiles u on u.id = m.sender_id
      left join chat_messages r on r.id = m.reply_to_id left join user_profiles ru on ru.id = r.sender_id
      left join tasks t on t.id = m.task_id
     where m.conversation_id = ${id} ${beforeCond}
     order by m.created_at desc, m.id desc limit ${PAGE}`
  return rows.reverse()
}

export async function chatSync(ctx: Ctx, f: { conversationId?: string; read?: boolean; typing?: boolean; before?: string }) {
  const id = f.conversationId && UUID_RE.test(f.conversationId) ? f.conversationId : null
  return run(ctx, async (tx) => {
    await tx`select app.chat_heartbeat(${id}, ${!!f.read}, ${!!f.typing})`
    const conversations = await listConversationsTx(ctx, tx)
    if (!id) return { conversations, messages: [], typing: [], members: [], pinned: [], hasMore: false }
    const messages = await messagesOf(ctx, tx, id, f.before)
    const typing = await tx<{ full_name: string }[]>`select u.full_name from chat_members c join user_profiles u on u.id = c.user_id where c.conversation_id = ${id} and c.user_id <> ${ctx.userId} and c.left_at is null and c.typing_until > now()`
    const members = await tx<{ user_id: string; full_name: string; role: string; online: boolean }[]>`
      select c.user_id, u.full_name, c.role, coalesce(pr.last_seen_at > now() - make_interval(secs => ${ONLINE_SECONDS}), false) as online
        from chat_members c join user_profiles u on u.id = c.user_id left join chat_presence pr on pr.user_id = c.user_id where c.conversation_id = ${id} and c.left_at is null order by u.full_name`
    const pinned = await tx<{ id: string; body: string; sender_name: string }[]>`select m.id, left(m.body, 120) as body, u.full_name as sender_name from chat_messages m join user_profiles u on u.id = m.sender_id where m.conversation_id = ${id} and m.pinned_at is not null and m.deleted_at is null order by m.pinned_at desc limit 5`
    return { conversations, messages, typing: typing.map((t) => t.full_name), members, pinned, hasMore: messages.length === PAGE }
  })
}
// Same list, inside the sync transaction.
const listConversationsTx = async (ctx: Ctx, tx: Parameters<Parameters<typeof run>[1]>[0]) => tx<{ id: string; unread: number; last_at: Date | null }[]>`
  select c.conversation_id as id, (select count(*)::int from chat_messages m where m.conversation_id = c.conversation_id and m.created_at > c.last_read_at and m.sender_id <> ${ctx.userId} and m.deleted_at is null) as unread,
         (select max(m.created_at) from chat_messages m where m.conversation_id = c.conversation_id) as last_at
    from chat_members c where c.user_id = ${ctx.userId} and c.left_at is null`

export async function chatUnreadCount(ctx: Ctx) {
  const [r] = await run(ctx, (tx) => tx<{ n: number }[]>`select coalesce(sum((select count(*) from chat_messages m where m.conversation_id = c.conversation_id and m.created_at > c.last_read_at and m.sender_id <> ${ctx.userId} and m.deleted_at is null)), 0)::int as n from chat_members c where c.user_id = ${ctx.userId} and c.left_at is null`)
  return r.n
}

export async function chatPeople(ctx: Ctx) {
  return run(ctx, (tx) => tx<{ id: string; full_name: string; org_id: string; org_name: string }[]>`
    select u.id, u.full_name, m.org_id, o.name as org_name from organization_memberships m join user_profiles u on u.id = m.user_id and u.account_status = 'active' join organizations o on o.id = m.org_id
     where m.is_active and u.id <> ${ctx.userId} and m.org_id = any(${tx.array(ctx.memberships.map((x) => x.orgId))}::uuid[]) order by u.full_name`)
}

/** Open tasks the person is assigned to or created, to link a message to. Row-level security and chat_send both check access again. */
export async function chatTaskOptions(ctx: Ctx, orgId: string) {
  return run(ctx, (tx) => tx<{ id: string; title: string }[]>`
    select t.id, t.title from tasks t where t.org_id = ${orgId} and (t.assigned_to = ${ctx.userId} or t.created_by = ${ctx.userId}) and t.status not in ('completed', 'cancelled')
     order by t.created_at desc limit 50`)
}

export async function openDirect(ctx: Ctx, orgId: string, otherId: string) {
  if (!UUID_RE.test(orgId) || !UUID_RE.test(otherId)) throw invalid('Choose a person.')
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.chat_open_direct(${orgId}, ${otherId}) as id`)
  return r.id
}

export async function createGroup(ctx: Ctx, v: { orgId?: string; name?: string; groupType?: string; members?: string[] }) {
  const name = v.name?.trim() ?? ''
  if (name.length < 2 || name.length > 100) throw invalid('Enter a group name.', { name: ['Enter a group name.'] })
  if (!UUID_RE.test(v.orgId ?? '') || !can(ctx, 'chat.groups.manage', v.orgId!)) throw forbidden()
  if (!GROUP_TYPES.some(([k]) => k === v.groupType)) throw invalid('Choose the type of group.')
  const members = (v.members ?? []).filter((m) => UUID_RE.test(m))
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.chat_create_group(${v.orgId!}, ${name}, ${v.groupType!}, ${members}::uuid[]) as id`)
  return r.id
}
export const setGroupMember = (ctx: Ctx, conv: string, user: string, present: boolean) => run(ctx, (tx) => tx`select app.chat_set_member(${conv}, ${user}, ${present})`).then(() => undefined)
export const syncGroup = (ctx: Ctx, conv: string) => run(ctx, (tx) => tx`select app.chat_sync_group(${conv})`).then(() => undefined)

export async function sendMessage(ctx: Ctx, conv: string, v: { body?: string; replyTo?: string; forwardFrom?: string; taskId?: string; file?: File | null }) {
  if (!UUID_RE.test(conv)) throw notFound()
  const body = (v.body ?? '').trim()
  const hasFile = v.file instanceof File && v.file.size > 0
  if (!body && !hasFile && !v.forwardFrom) throw invalid('Write a message.')
  if (body.length > 4000) throw invalid('The message is too long.')
  const ok = (x?: string) => (x && UUID_RE.test(x) ? x : null)
  // Check the file first, so a refused file never leaves a message behind.
  if (hasFile) {
    const f = v.file as File
    if (f.size > MAX_UPLOAD_BYTES) throw invalid('The file is larger than 10 MB.')
    if (!sniffMime(Buffer.from(await f.arrayBuffer()))) throw invalid('Only PDF, JPEG, PNG or WebP files are accepted.')
  }
  const id = await run(ctx, async (tx) => {
    // @mentions are matched against the members of this conversation only
    const members = body.includes('@') ? await tx<{ user_id: string; full_name: string }[]>`select c.user_id, u.full_name from chat_members c join user_profiles u on u.id = c.user_id where c.conversation_id = ${conv} and c.left_at is null` : []
    const mentions = members.filter((m) => body.toLowerCase().includes(`@${m.full_name.toLowerCase()}`) || body.toLowerCase().includes(`@${m.full_name.split(/\s+/)[0].toLowerCase()}`)).map((m) => m.user_id)
    const [r] = await tx<{ id: string }[]>`select app.chat_send(${conv}, ${body}, ${ok(v.replyTo)}, ${ok(v.forwardFrom)}, ${ok(v.taskId)}, ${mentions}::uuid[]) as id`
    return r.id
  })
  if (hasFile) {
    try { await uploadSecureFile(ctx, 'chat', id, v.file as File) } catch (e) {
      if (!body) await run(ctx, (tx) => tx`select app.chat_delete(${id})`).catch(() => {})
      throw e
    }
  }
  return id
}
export const editMessage = (ctx: Ctx, id: string, body: string) => run(ctx, (tx) => tx`select app.chat_edit(${id}, ${(body ?? '').slice(0, 4000)})`).then(() => undefined)
export const deleteMessage = (ctx: Ctx, id: string) => run(ctx, (tx) => tx`select app.chat_delete(${id})`).then(() => undefined)
export const reactToMessage = async (ctx: Ctx, id: string, emoji: string, on: boolean) => {
  if (!(REACTIONS as readonly string[]).includes(emoji)) throw invalid('Unknown reaction.')
  return run(ctx, (tx) => tx`select app.chat_react(${id}, ${emoji}, ${on})`).then(() => undefined)
}
export const pinMessage = (ctx: Ctx, id: string, on: boolean) => run(ctx, (tx) => tx`select app.chat_pin(${id}, ${on})`).then(() => undefined)

export async function searchChat(ctx: Ctx, q: string, page = 1) {
  const term = q.trim().replace(/[%_]/g, '')
  if (term.length < 2) return []
  return run(ctx, (tx) => tx<{ id: string; conversation_id: string; body: string; created_at: Date; sender_name: string }[]>`
    select m.id, m.conversation_id, left(m.body, 200) as body, m.created_at, u.full_name as sender_name from chat_messages m join user_profiles u on u.id = m.sender_id
     where m.deleted_at is null and m.body ilike ${'%' + term + '%'} order by m.created_at desc limit 30 offset ${(page - 1) * 30}`)
}
