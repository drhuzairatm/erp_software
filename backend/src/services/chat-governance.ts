import { invalid } from '../lib/errors'
import { type Ctx, run } from './base'

/**
 * Chat retention, legal holds and restricted investigation access. There is no permission for this: the database recognises the MD by the
 * protected role, and everyone else only by a named grant from the MD. Reading needs a request approved for one named reader, and every read is logged.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const id = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null)
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const days = (v: unknown, label: string) => {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (!/^\d{1,5}$/.test(s) || Number(s) < 1) throw invalid(`${label} must be a whole number of days.`)
  return Number(s)
}
export const CAPABILITIES = [['requester', 'May request an investigation'], ['approver', 'May authorise requests and legal holds'], ['reader', 'May read, when a request names them']] as const

export interface GovernanceOrg { org_id: string; org_name: string; is_md: boolean; requester: boolean; approver: boolean; reader: boolean }
export async function governanceAccess(ctx: Ctx) {
  const rows = await run(ctx, (tx) => tx<GovernanceOrg[]>`
    select o.id as org_id, o.name as org_name, app.chatgov_is_md(o.id) as is_md, app.chatgov_has(o.id, 'requester') as requester, app.chatgov_has(o.id, 'approver') as approver, app.chatgov_has(o.id, 'reader') as reader
      from organizations o where o.id = any(${tx.array(ctx.memberships.map((m) => m.orgId))}::uuid[]) and app.chatgov_can_view(o.id) order by o.name`)
  return rows
}

export interface RequestRow { id: string; org_id: string; reference: string; reason: string; status: string; requested_at: Date; requester: string; approver: string | null; reader: string; reader_id: string; requested_by: string; decided_at: Date | null; decision_note: string | null; expires_at: Date | null; scope_user: string | null; scope_group: string | null; scope_direct: boolean; from_date: string | null; to_date: string | null; reads: number; last_read_at: Date | null }

export async function governanceData(ctx: Ctx, orgId: string) {
  return run(ctx, async (tx) => {
    const [policy] = await tx<{ retention_days: number | null; archive_retention_days: number | null; purge_enabled: boolean; approval_reference: string | null; approver: string | null; approved_at: Date | null }[]>`
      select p.retention_days, p.archive_retention_days, p.purge_enabled, p.approval_reference, u.full_name as approver, p.approved_at from chatgov_retention_policies p left join user_profiles u on u.id = p.approved_by where p.org_id = ${orgId}`
    const runs = await tx<{ id: string; ran_at: Date; archived: number; purged: number; held_skipped: number }[]>`select id, ran_at, archived, purged, held_skipped from chatgov_retention_runs where org_id = ${orgId} order by ran_at desc limit 5`
    const delegates = await tx<{ id: string; user_id: string; full_name: string; capability: string; reason: string; granted_at: Date }[]>`
      select d.id, d.user_id, u.full_name, d.capability, d.reason, d.granted_at from chatgov_delegates d join user_profiles u on u.id = d.user_id where d.org_id = ${orgId} and d.revoked_at is null order by u.full_name, d.capability`
    const holds = await tx<{ id: string; reference: string; reason: string; subject: string | null; group_name: string | null; placed_by: string; placed_at: Date; released_at: Date | null; release_reason: string | null }[]>`
      select h.id, h.reference, h.reason, s.full_name as subject, c.name as group_name, p.full_name as placed_by, h.placed_at, h.released_at, h.release_reason
        from chatgov_holds h join user_profiles p on p.id = h.placed_by left join user_profiles s on s.id = h.scope_user left join lateral (select g.name from app.chatgov_groups(${orgId}) g where g.id = h.scope_conversation) c on true
       where h.org_id = ${orgId} order by h.released_at nulls first, h.placed_at desc limit 50`
    const requests = await requestRows(ctx, tx, orgId)
    const people = await tx<{ id: string; full_name: string }[]>`select u.id, u.full_name from organization_memberships m join user_profiles u on u.id = m.user_id where m.org_id = ${orgId} and m.is_active order by u.full_name`
    const groups = await tx<{ id: string; name: string }[]>`select id, name from app.chatgov_groups(${orgId})`
    return { policy: policy ?? null, runs, delegates, holds, requests, people, groups }
  })
}

const requestRows = (ctx: Ctx, tx: Parameters<Parameters<typeof run>[1]>[0], orgId: string | null, requestId?: string) => tx<RequestRow[]>`
  select q.id, q.org_id, q.reference, q.reason, q.status, q.requested_at, rq.full_name as requester, ap.full_name as approver, rd.full_name as reader, q.reader_id, q.requested_by, q.decided_at, q.decision_note, q.expires_at,
         s.full_name as scope_user, (select g.name from app.chatgov_groups(q.org_id) g where g.id = q.scope_conversation) as scope_group, q.scope_conversation is not null as scope_direct, q.from_date::text, q.to_date::text,
         (select count(*)::int from chatgov_access_log l where l.request_id = q.id) as reads, (select max(l.accessed_at) from chatgov_access_log l where l.request_id = q.id) as last_read_at
    from chatgov_requests q join user_profiles rq on rq.id = q.requested_by join user_profiles rd on rd.id = q.reader_id left join user_profiles ap on ap.id = q.decided_by left join user_profiles s on s.id = q.scope_user
   where ${requestId ? tx`q.id = ${requestId}` : tx`q.org_id = ${orgId}`} order by q.requested_at desc limit 100`

export async function getRequest(ctx: Ctx, requestId: string) {
  if (!UUID_RE.test(requestId)) return null
  return run(ctx, async (tx) => {
    const [request] = await requestRows(ctx, tx, null, requestId)
    if (!request) return null
    const log = await tx<{ id: string; accessor: string; accessed_at: Date; count: number; message_ids: string[] }[]>`
      select l.id, u.full_name as accessor, l.accessed_at, cardinality(l.message_ids) as count, l.message_ids from chatgov_access_log l join user_profiles u on u.id = l.accessor_id where l.request_id = ${requestId} order by l.accessed_at desc limit 100`
    return { request, log }
  })
}

export const setRetention = async (ctx: Ctx, orgId: string, v: { retentionDays?: unknown; archiveDays?: unknown; purge?: boolean; reference?: string }) => {
  const d = days(v.retentionDays, 'The retention period'); const a = days(v.archiveDays, 'The archive period')
  await run(ctx, (tx) => tx`select app.chatgov_set_retention(${orgId}, ${d}, ${a}, ${!!v.purge}, ${v.reference ?? null})`)
}
export const setDelegate = async (ctx: Ctx, orgId: string, user: string, capability: string, on: boolean, reason: string) => {
  if (!CAPABILITIES.some(([k]) => k === capability)) throw invalid('Choose the responsibility.')
  if (!UUID_RE.test(user)) throw invalid('Choose a person.')
  if (on && reason.trim().length < 3) throw invalid('Give the reason for this grant.')
  await run(ctx, (tx) => tx`select app.chatgov_set_delegate(${orgId}, ${user}, ${capability}, ${on}, ${reason})`)
}
export const placeHold = async (ctx: Ctx, orgId: string, v: { reference?: string; reason?: string; user?: string; group?: string }) => {
  if ((v.reference ?? '').trim().length < 3) throw invalid('Give the case reference.')
  if ((v.reason ?? '').trim().length < 10) throw invalid('Give the reason for the hold (at least 10 characters).')
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.chatgov_place_hold(${orgId}, ${v.reference!}, ${v.reason!}, ${id(v.user)}, ${id(v.group)}) as id`)
  return r.id
}
export const releaseHold = async (ctx: Ctx, hold: string, reason: string) => { await run(ctx, (tx) => tx`select app.chatgov_release_hold(${hold}, ${reason})`) }
export const createRequest = async (ctx: Ctx, orgId: string, v: { reference?: string; reason?: string; user?: string; user2?: string; group?: string; from?: string; to?: string; reader?: string }) => {
  if ((v.reference ?? '').trim().length < 3) throw invalid('Give the case reference.')
  if ((v.reason ?? '').trim().length < 10) throw invalid('Give the reason (at least 10 characters).')
  if (!id(v.reader)) throw invalid('Choose who will read.')
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.chatgov_request(${orgId}, ${v.reference!}, ${v.reason!}, ${id(v.user)}, ${id(v.user2)}, ${id(v.group)}, ${date(v.from)}, ${date(v.to)}, ${v.reader!}) as id`)
  return r.id
}
export const decideRequest = async (ctx: Ctx, request: string, approve: boolean, note: string, daysValue: unknown) => {
  const d = approve ? days(daysValue, 'The access period') : null
  await run(ctx, (tx) => tx`select app.chatgov_decide(${request}, ${approve}, ${note}, ${d})`)
}
export const closeRequest = async (ctx: Ctx, request: string) => { await run(ctx, (tx) => tx`select app.chatgov_close(${request})`) }

export interface ArchivedMessage { id: string; conversation_id: string; sender: string; created_at: string; edited_at: string | null; deleted_at: string | null; body: string; history: { action: string; body: string; at: string; by: string | null }[]; files: { name: string; sha256: string; removed_at: string | null }[] }
/** Writes the access log in the same transaction: there is no read without its record. */
export async function readRequest(ctx: Ctx, request: string, offset = 0) {
  const [r] = await run(ctx, (tx) => tx<{ d: { total: number; messages: ArchivedMessage[] } }[]>`select app.chatgov_read(${request}, ${Math.max(0, offset)}) as d`)
  return r.d
}
