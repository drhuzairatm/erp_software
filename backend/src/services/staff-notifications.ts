import { invalid } from '../lib/errors'
import { PAGE_SIZE, type Ctx, pageOf, run } from './base'

/** The signed-in employee's own notifications. Row-level security limits every query here to that person. */
export interface StaffNotification {
  id: string; event_key: string; title: string; href: string; severity: string; created_at: Date; read_at: Date | null
  org_name: string; detail: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function listMyNotifications(ctx: Ctx, f: { unread?: boolean; page?: unknown } = {}) {
  const page = pageOf(f.page)
  return run(ctx, async (tx) => {
    const only = f.unread ? tx`and n.read_at is null` : tx``
    // details come from the record itself, so they appear only while the reader can still see it
    const rows = await tx<StaffNotification[]>`
      select n.id, n.event_key, n.title, n.href, n.severity, n.created_at, n.read_at, o.name as org_name,
             coalesce(t.title, nullif(d.label, '')) as detail
        from staff_notifications n
        join organizations o on o.id = n.org_id
        left join tasks t on n.subject_type = 'task' and t.id = n.subject_id
        left join student_documents d on n.subject_type = 'document' and d.id = n.subject_id
       where true ${only}
       order by n.created_at desc, n.id limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    const [c] = await tx<{ total: number; unread: number }[]>`
      select count(*)::int as total, count(*) filter (where n.read_at is null)::int as unread from staff_notifications n`
    return { rows, page, pageSize: PAGE_SIZE, total: f.unread ? c.unread : c.total, unread: c.unread }
  })
}

/** For the header on every page: the unread count and the latest unread items. */
export async function myNotificationSummary(ctx: Ctx) {
  return run(ctx, async (tx) => {
    const [{ unread }] = await tx<{ unread: number }[]>`select count(*)::int as unread from staff_notifications n where n.read_at is null`
    const latest = unread === 0 ? [] : await tx<Pick<StaffNotification, 'id' | 'title' | 'severity' | 'created_at'>[]>`
      select n.id, n.title, n.severity, n.created_at from staff_notifications n where n.read_at is null order by n.created_at desc, n.id limit 5`
    return { unread, latest }
  })
}

/** Marks one of the person's own notifications as read and returns where it points; null if it isn't theirs. */
export async function openMyNotification(ctx: Ctx, id: string): Promise<string | null> {
  if (!UUID_RE.test(id)) return null
  return run(ctx, async (tx) => {
    const [n] = await tx<{ href: string }[]>`select n.href from staff_notifications n where n.id = ${id}`
    if (!n) return null
    await tx`select app.mark_staff_notifications_read(${[id]}::uuid[])`
    return n.href
  })
}

export async function markAllMyNotificationsRead(ctx: Ctx) {
  return run(ctx, async (tx) => {
    const [{ n }] = await tx<{ n: number }[]>`select app.mark_staff_notifications_read(null) as n`
    return n
  })
}

/** Preferences. Critical notifications and announcements always arrive, so they are not listed here. */
export const NOTIFICATION_CATEGORIES = [
  { key: 'tasks', label: 'Tasks', help: 'Assigned, due, overdue, comments and files' },
  { key: 'documents', label: 'Documents', help: 'Approvals, rejections and changes required' },
  { key: 'attendance', label: 'Attendance', help: 'Check-in reminders, corrections and reviews' },
  { key: 'meetings', label: 'Meetings', help: 'Invitations, minutes and action points' },
  { key: 'chat', label: 'Chat', help: 'Direct messages and mentions' },
  { key: 'verification', label: 'Document verification', help: 'Pre-admission verification requests' },
  { key: 'tickets', label: 'Student tickets', help: 'Questions from the student portal' },
] as const

export async function myNotificationPreferences(ctx: Ctx) {
  const rows = await run(ctx, (tx) => tx<{ category: string; in_app: boolean; email: boolean }[]>`select category, in_app, email from staff_notification_preferences`)
  return NOTIFICATION_CATEGORIES.map((c) => {
    const r = rows.find((x) => x.category === c.key)
    return { ...c, in_app: r?.in_app ?? true, email: r?.email ?? true }
  })
}

export async function setMyNotificationPreference(ctx: Ctx, category: string, inApp: boolean, email: boolean) {
  if (!NOTIFICATION_CATEGORIES.some((c) => c.key === category)) throw invalid('Unknown category.')
  await run(ctx, (tx) => tx`select app.set_my_notification_preference(${category}, ${inApp}, ${inApp && email})`)
}

export interface Announcement { id: string; org_id: string; org_name: string; title: string; body: string; severity: string; published_at: Date; publisher: string | null; withdrawn_at: Date | null; can_manage: boolean }

export async function listAnnouncements(ctx: Ctx, f: { page?: unknown } = {}) {
  const page = pageOf(f.page)
  return run(ctx, async (tx) => {
    const rows = await tx<Announcement[]>`
      select a.id, a.org_id, o.name as org_name, a.title, a.body, a.severity, a.published_at, u.full_name as publisher, a.withdrawn_at,
             app.has_perm(a.org_id, 'announcements.publish') as can_manage
        from staff_announcements a join organizations o on o.id = a.org_id left join user_profiles u on u.id = a.published_by
       order by a.published_at desc, a.id limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    const [c] = await tx<{ n: number }[]>`select count(*)::int as n from staff_announcements`
    return { rows, page, pageSize: PAGE_SIZE, total: c.n }
  })
}

export async function publishAnnouncement(ctx: Ctx, raw: Record<string, string | undefined>) {
  const title = raw.title?.trim() ?? ''; const body = raw.body?.trim() ?? ''; const severity = raw.severity ?? 'info'
  const errs: Record<string, string[]> = {}
  if (title.length < 3 || title.length > 150) errs.title = ['Enter a title of 3 to 150 characters.']
  if (body.length < 3 || body.length > 4000) errs.body = ['Enter the announcement, up to 4000 characters.']
  if (!UUID_RE.test(raw.orgId ?? '')) errs.orgId = ['Choose the company.']
  if (!['info', 'warning', 'critical'].includes(severity)) errs.severity = ['Choose a level.']
  if (Object.keys(errs).length) throw invalid('Please correct the highlighted fields.', errs)
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.publish_announcement(${raw.orgId!}, ${title}, ${body}, ${severity}) as id`)
  return r.id
}

export async function withdrawAnnouncement(ctx: Ctx, id: string) {
  if (!UUID_RE.test(id)) throw invalid('Not found.')
  await run(ctx, (tx) => tx`select app.withdraw_announcement(${id})`)
}
