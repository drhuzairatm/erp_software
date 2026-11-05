import { can, orgsWith } from '../lib/auth/context'
import { forbidden, invalid, notFound } from '../lib/errors'
import { PAGE_SIZE, type Ctx, pageOf, run } from './base'

/** Meetings and minutes. Row-level security limits every read to the Core Team, attendees, the note taker and holders of meetings.manage. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const dt = (date?: string, time?: string) => (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && time && /^\d{2}:\d{2}$/.test(time) ? new Date(`${date}T${time}:00+05:30`) : null)

export async function hasMeetingAccess(ctx: Ctx) {
  if (orgsWith(ctx, 'meetings.manage').length) return true
  if (!ctx.memberships.length) return false
  const [r] = await run(ctx, (tx) => tx<{ ok: boolean }[]>`select exists (select 1 from meetings) or exists (select 1 from core_team_members where user_id = ${ctx.userId} and removed_at is null) as ok`)
  return r.ok
}

export interface MeetingRow { id: string; org_id: string; org_name: string; title: string; meeting_type: string; scheduled_at: Date; location: string | null; status: string; note_taker: string | null; attendee_count: number; has_minutes: boolean }

export async function listMeetings(ctx: Ctx, orgIds: string[], f: { view?: string; q?: string; page?: unknown } = {}) {
  const page = pageOf(f.page)
  return run(ctx, async (tx) => {
    const when = f.view === 'past' ? tx`and m.scheduled_at < now()` : f.view === 'upcoming' ? tx`and m.scheduled_at >= now()` : tx``
    const q = f.q?.trim() ? tx`and m.title ilike ${'%' + f.q.trim().replace(/[%_]/g, '') + '%'}` : tx``
    const rows = await tx<(MeetingRow & { total: string })[]>`
      select m.id, m.org_id, o.name as org_name, m.title, m.meeting_type, m.scheduled_at, m.location, m.status, u.full_name as note_taker,
             (select count(*)::int from meeting_attendees a where a.meeting_id = m.id) as attendee_count,
             exists (select 1 from meeting_minutes x where x.meeting_id = m.id) as has_minutes, count(*) over () as total
        from meetings m join organizations o on o.id = m.org_id left join user_profiles u on u.id = m.note_taker_id
       where m.org_id = any(${tx.array(orgIds)}::uuid[]) ${when} ${q}
       order by m.scheduled_at desc, m.id limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    return { rows, total: Number(rows[0]?.total ?? 0), page, pageSize: PAGE_SIZE }
  })
}

export async function getMeeting(ctx: Ctx, id: string) {
  if (!UUID_RE.test(id)) return null
  return run(ctx, async (tx) => {
    const [m] = await tx<(MeetingRow & { agenda: string | null; note_taker_id: string | null; created_by: string; can_edit: boolean })[]>`
      select m.*, o.name as org_name, u.full_name as note_taker, app.meeting_can_edit(m.id) as can_edit,
             exists (select 1 from meeting_minutes x where x.meeting_id = m.id) as has_minutes, 0 as attendee_count
        from meetings m join organizations o on o.id = m.org_id left join user_profiles u on u.id = m.note_taker_id where m.id = ${id}`
    if (!m) return null
    const [attendees, minutes, versions, decisions, actions, staff] = await Promise.all([
      tx<{ user_id: string; full_name: string }[]>`select a.user_id, u.full_name from meeting_attendees a join user_profiles u on u.id = a.user_id where a.meeting_id = ${id} order by u.full_name`,
      tx<{ discussion_notes: string; version: number; updated_at: Date; editor: string | null }[]>`select x.discussion_notes, x.version, x.updated_at, u.full_name as editor from meeting_minutes x left join user_profiles u on u.id = x.updated_by where x.meeting_id = ${id}`,
      tx<{ id: string; version: number; edit_reason: string | null; edited_at: Date; editor: string | null; discussion_notes: string }[]>`select v.id, v.version, v.edit_reason, v.edited_at, v.discussion_notes, u.full_name as editor from meeting_minutes_versions v left join user_profiles u on u.id = v.edited_by where v.meeting_id = ${id} order by v.version desc`,
      tx<{ id: string; body: string; created_at: Date; author: string | null }[]>`select d.id, d.body, d.created_at, u.full_name as author from meeting_decisions d left join user_profiles u on u.id = d.created_by where d.meeting_id = ${id} order by d.created_at`,
      tx<{ id: string; decision_id: string | null; description: string; responsible_id: string | null; responsible: string | null; deadline: Date | null; priority: string; task_id: string | null; task_status: string | null }[]>`
        select a.id, a.decision_id, a.description, a.responsible_id, u.full_name as responsible, a.deadline, a.priority, a.task_id, t.status as task_status
          from meeting_action_points a left join user_profiles u on u.id = a.responsible_id left join tasks t on t.id = a.task_id where a.meeting_id = ${id} order by a.created_at`,
      tx<{ id: string; full_name: string }[]>`select u.id, u.full_name from organization_memberships mm join user_profiles u on u.id = mm.user_id and u.is_active where mm.org_id = ${m.org_id} and mm.is_active order by u.full_name`,
    ])
    return { meeting: m, attendees, minutes: minutes[0] ?? null, versions, decisions, actions, staff }
  })
}

export async function meetingFormData(ctx: Ctx) {
  const orgs = orgsWith(ctx, 'meetings.manage')
  if (!orgs.length) return { orgs: [], staff: [] }
  const staff = await run(ctx, (tx) => tx<{ id: string; full_name: string; org_id: string }[]>`
    select distinct u.id, u.full_name, m.org_id from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active where m.is_active and m.org_id = any(${tx.array(orgs)}::uuid[]) order by u.full_name`)
  return { orgs: ctx.memberships.filter((m) => orgs.includes(m.orgId)).map((m) => ({ id: m.orgId, name: m.orgName })), staff }
}

function meetingInput(v: Record<string, unknown>) {
  const errs: Record<string, string[]> = {}
  const title = String(v.title ?? '').trim()
  if (title.length < 2 || title.length > 200) errs.title = ['Enter a title.']
  const at = dt(v.date as string, v.time as string)
  if (!at) errs.date = ['Choose the date and time.']
  const attendees = (Array.isArray(v.attendees) ? v.attendees : []).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x))
  const noteTaker = UUID_RE.test(String(v.noteTaker ?? '')) ? String(v.noteTaker) : null
  if (Object.keys(errs).length) throw invalid('Please correct the highlighted fields.', errs)
  return { title, at: at!, attendees, noteTaker, type: v.meetingType === 'other' ? 'other' : 'daily_core', location: String(v.location ?? ''), agenda: String(v.agenda ?? '').slice(0, 8000) }
}

export async function createMeeting(ctx: Ctx, orgId: string, raw: Record<string, unknown>) {
  if (!UUID_RE.test(orgId) || !can(ctx, 'meetings.manage', orgId)) throw forbidden()
  const m = meetingInput(raw)
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.save_meeting(null, ${orgId}, ${m.title}, ${m.type}, ${m.at}, ${m.location}, ${m.agenda}, ${m.noteTaker}, ${m.attendees}::uuid[]) as id`)
  return r.id
}
export async function updateMeeting(ctx: Ctx, id: string, raw: Record<string, unknown>) {
  if (!UUID_RE.test(id)) throw notFound()
  const m = meetingInput(raw)
  await run(ctx, (tx) => tx`select app.save_meeting(${id}, null, ${m.title}, ${m.type}, ${m.at}, ${m.location}, ${m.agenda}, ${m.noteTaker}, ${m.attendees}::uuid[])`)
}
export const cancelMeeting = (ctx: Ctx, id: string) => run(ctx, (tx) => tx`select app.cancel_meeting(${id})`).then(() => undefined)
export async function saveMinutes(ctx: Ctx, id: string, notes: string, reason?: string) {
  if (!UUID_RE.test(id)) throw notFound()
  if ((notes ?? '').length > 50000) throw invalid('The minutes are too long.')
  const [r] = await run(ctx, (tx) => tx<{ v: number }[]>`select app.save_meeting_minutes(${id}, ${notes}, ${reason ?? null}) as v`)
  return r.v
}
export async function addDecision(ctx: Ctx, id: string, body: string) {
  const b = (body ?? '').trim()
  if (b.length < 2 || b.length > 4000) throw invalid('Write the decision.', { body: ['Write the decision.'] })
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.add_meeting_decision(${id}, ${b}) as id`)
  return r.id
}
export async function addAction(ctx: Ctx, id: string, v: Record<string, string | undefined>) {
  const d = (v.description ?? '').trim()
  if (d.length < 2 || d.length > 2000) throw invalid('Describe the action point.', { description: ['Describe the action point.'] })
  const priority = ['low', 'normal', 'high', 'urgent'].includes(v.priority ?? '') ? v.priority! : 'normal'
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.add_meeting_action(${id}, ${UUID_RE.test(v.decisionId ?? '') ? v.decisionId! : null}, ${d}, ${UUID_RE.test(v.responsible ?? '') ? v.responsible! : null}, ${dt(v.date, v.time || '18:00')}, ${priority}) as id`)
  return r.id
}
export async function actionToTask(ctx: Ctx, actionId: string) {
  if (!UUID_RE.test(actionId)) throw notFound()
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.meeting_action_to_task(${actionId}) as id`)
  return r.id
}

export async function coreTeam(ctx: Ctx, orgId: string) {
  if (!can(ctx, 'meetings.manage', orgId)) throw forbidden()
  return run(ctx, (tx) => tx<{ user_id: string; full_name: string; job_title: string | null; member: boolean }[]>`
    select u.id as user_id, u.full_name, u.job_title, exists (select 1 from core_team_members c where c.org_id = ${orgId} and c.user_id = u.id and c.removed_at is null) as member
      from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active where m.org_id = ${orgId} and m.is_active order by u.full_name`)
}
export const setCoreTeamMember = (ctx: Ctx, orgId: string, userId: string, member: boolean) => run(ctx, (tx) => tx`select app.set_core_team_member(${orgId}, ${userId}, ${member})`).then(() => undefined)
