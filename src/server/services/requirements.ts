import { can } from '../auth/context'
import { forbidden, invalid, notFound } from '../errors'
import { type Ctx, run } from './base'

const UUID = /^[0-9a-f-]{36}$/i
const opt = (v?: string | null) => (v && UUID.test(v) ? v : null)
const date = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null)

export const CATEGORIES = {
  academic_marks: 'Academic marks', age: 'Age recommendation', subject_prerequisite: 'Subject prerequisites', language: 'Language requirement',
  entrance_exam: 'Entrance examination', document: 'Document requirement', nationality: 'Nationality-specific note', general: 'General',
} as const
export const DISPLAY_TYPES = {
  critical_alert: 'Critical alert', mandatory_notice: 'Mandatory notice', important_warning: 'Important warning',
  additional_point: 'Additional point', general_information: 'General information',
} as const
export const PRIORITIES = { critical: 'Critical', high: 'High', normal: 'Normal', informational: 'Informational' } as const
export const ACADEMIC_STATUS: Record<string, { label: string; level: 'success' | 'warning' | 'info' }> = {
  meets: { label: 'Academic marks meet configured requirements', level: 'success' },
  below: { label: 'Academic marks below configured requirements', level: 'warning' },
  missing: { label: 'Academic information missing', level: 'warning' },
  manual_review: { label: 'Manual review recommended', level: 'warning' },
}

export interface AdvisoryItem { subject: string; subject_key: string; record_kind: string; min_percentage: number | null; min_marks: number | null; actual: number | null; result: 'ok' | 'below' | 'missing' | 'not_comparable' }
export interface StudentAdvisory {
  notice_id: string; notice_group_id: string; version: number; category: keyof typeof CATEGORIES; display_type: keyof typeof DISPLAY_TYPES
  priority: keyof typeof PRIORITIES; title: string; message: string; description: string | null; notes: string | null; requires_acknowledgement: boolean
  country: string; university: string | null; course: string | null; items: AdvisoryItem[]; academic_status: string | null
  acknowledged_at: Date | null; acknowledged_by: string | null; earlier_acknowledgement: boolean
}

export const canManageRequirements = (ctx: Ctx) => can(ctx, 'requirements.manage')

/** Notices that apply to a student (advisory). Empty when nothing is configured — nothing is ever invented. */
export async function studentAdvisories(ctx: Ctx, studentId: string): Promise<StudentAdvisory[]> {
  if (!UUID.test(studentId)) return []
  return run(ctx, async (tx) => {
    if (!(await tx`select 1 from v_students where id = ${studentId}`).length) return []
    return tx<StudentAdvisory[]>`select * from app.student_advisories(${studentId})`
  })
}

export async function acknowledgeAdvisory(ctx: Ctx, studentId: string, noticeId: string) {
  if (!UUID.test(noticeId)) throw invalid('Unknown notice.')
  return run(ctx, (tx) => tx`select app.acknowledge_advisory(${studentId}, ${noticeId})`)
}

export async function acknowledgementHistory(ctx: Ctx, studentId: string) {
  return run(ctx, (tx) => tx<{ id: string; title: string; version: number; acknowledged_at: Date; by: string; academic_status: string | null }[]>`
    select a.id, n.title, n.version, a.acknowledged_at, u.full_name as by, a.academic_status
      from advisory_acknowledgements a join advisory_notices n on n.id = a.notice_id join user_profiles u on u.id = a.acknowledged_by
     where a.student_id = ${studentId} order by a.acknowledged_at desc`)
}

/** Active notices per destination country (for the registration form: shown when a country is selected). */
export async function noticesByCountry(ctx: Ctx) {
  const rows = await run(ctx, (tx) => tx<{ country_id: string; title: string; message: string; display_type: string; priority: string; university: string | null; course: string | null
    items: { subject: string; min_percentage: number | null; min_marks: number | null }[] }[]>`
    select n.destination_country_id as country_id, n.title, n.message, n.display_type, n.priority, u.name as university, c.name as course,
           coalesce((select jsonb_agg(jsonb_build_object('subject', i.subject_name, 'min_percentage', i.min_percentage, 'min_marks', i.min_marks) order by i.sort_order)
                       from advisory_notice_items i where i.notice_id = n.id), '[]'::jsonb) as items
      from advisory_notices n left join universities u on u.id = n.university_id left join courses c on c.id = n.course_id
     where n.status = 'active' and n.effective_from <= current_date and (n.effective_to is null or n.effective_to >= current_date)
     order by array_position(array['critical','high','normal','informational'], n.priority), n.title`)
  return rows
}

export interface RequirementRow {
  id: string; notice_group_id: string; version: number; category: string; display_type: string; priority: string; title: string; message: string
  description: string | null; notes: string | null; requires_acknowledgement: boolean; effective_from: string; effective_to: string | null; status: string
  destination_country_id: string; country: string; university_id: string | null; university: string | null; course_id: string | null; course: string | null
  updated_by: string | null; created_at: Date
  items: { record_kind: string; subject_key: string; subject_name: string; min_percentage: string | null; min_marks: string | null; grading_system: string | null; description: string | null }[]
}
const REQ_SELECT = `
  select n.*, c.name as country, u.name as university, co.name as course, up.full_name as updated_by,
         coalesce((select jsonb_agg(to_jsonb(i) - 'id' - 'notice_id' order by i.sort_order) from advisory_notice_items i where i.notice_id = n.id), '[]'::jsonb) as items
    from advisory_notices n join countries c on c.id = n.destination_country_id left join universities u on u.id = n.university_id
    left join courses co on co.id = n.course_id left join user_profiles up on up.id = n.created_by`

export async function listRequirements(ctx: Ctx) {
  return run(ctx, (tx) => tx.unsafe<RequirementRow[]>(`${REQ_SELECT} where n.status <> 'superseded'
    order by n.status, c.name, array_position(array['critical','high','normal','informational'], n.priority), n.title`))
}

export async function getRequirement(ctx: Ctx, groupId: string) {
  if (!UUID.test(groupId)) return null
  return run(ctx, async (tx) => {
    const versions = await tx.unsafe<RequirementRow[]>(`${REQ_SELECT} where n.notice_group_id = $1 order by n.version desc`, [groupId])
    if (!versions.length) return null
    const events = canManageRequirements(ctx) ? await tx<{ id: string; version: number; action: string; reason: string | null; previous: unknown; current: unknown; actor: string | null; occurred_at: Date }[]>`
      select e.id::text, e.version, e.action, e.reason, e.previous, e.current, u.full_name as actor, e.occurred_at
        from advisory_notice_events e left join user_profiles u on u.id = e.actor_id where e.notice_group_id = ${groupId} order by e.occurred_at desc` : []
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from advisory_acknowledgements a join advisory_notices x on x.id = a.notice_id where x.notice_group_id = ${groupId}`
    return { current: versions.find((v) => v.status !== 'superseded') ?? versions[0], versions, events, acknowledgements: n }
  })
}

export interface ItemInput { record_kind?: string; subject_key?: string; subject_name?: string; min_percentage?: string; min_marks?: string; grading_system?: string }

export async function saveRequirement(ctx: Ctx, groupId: string | null, v: Record<string, string | undefined>, items: ItemInput[], reason?: string) {
  if (!canManageRequirements(ctx)) throw forbidden('Only administrators can manage country-wise requirements.')
  const title = v.title?.trim(); const message = v.message?.trim()
  if (!opt(v.destinationCountryId)) throw invalid('Choose the country.', { destinationCountryId: ['Required.'] })
  if (!title || title.length < 3) throw invalid('Enter the notification title.', { title: ['Required.'] })
  if (!message || message.length < 3) throw invalid('Enter the notification message.', { message: ['Required.'] })
  if (!(v.category && v.category in CATEGORIES)) throw invalid('Choose the category.')
  if (!(v.displayType && v.displayType in DISPLAY_TYPES)) throw invalid('Choose the display type.')
  if (!(v.priority && v.priority in PRIORITIES)) throw invalid('Choose the priority.')
  const from = date(v.effectiveFrom); const to = date(v.effectiveTo)
  if (from && to && to < from) throw invalid('The expiry date must be after the effective date.', { effectiveTo: ['After effective date.'] })
  const cleanItems = items.filter((i) => i.subject_name?.trim()).map((i) => {
    const pct = i.min_percentage?.trim() ? Number(i.min_percentage) : null
    const marks = i.min_marks?.trim() ? Number(i.min_marks) : null
    if (pct === null && marks === null) throw invalid(`${i.subject_name}: enter a minimum percentage or minimum marks.`)
    if ((pct !== null && !(pct >= 0 && pct <= 100)) || (marks !== null && !(marks >= 0))) throw invalid(`${i.subject_name}: check the minimum.`)
    if (!['overall', 'physics', 'chemistry', 'biology', 'mathematics', 'english'].includes(i.subject_key ?? '')) throw invalid(`${i.subject_name}: choose the subject.`)
    return { record_kind: ['class_10', 'plus_two', 'bachelor', 'mbbs'].includes(i.record_kind ?? '') ? i.record_kind : 'plus_two', subject_key: i.subject_key,
      subject_name: i.subject_name!.trim().slice(0, 80), min_percentage: pct, min_marks: marks, grading_system: i.grading_system || null }
  })
  if (v.category === 'academic_marks' && cleanItems.length === 0) throw invalid('Add at least one subject requirement for an academic marks notice.')
  const p = {
    category: v.category, display_type: v.displayType, priority: v.priority, destination_country_id: v.destinationCountryId,
    university_id: opt(v.universityId), course_id: opt(v.courseId), title: title.slice(0, 200), message: message.slice(0, 4000),
    description: v.description?.slice(0, 4000) ?? null, notes: v.notes?.slice(0, 4000) ?? null, requires_acknowledgement: v.requiresAcknowledgement === 'yes',
    effective_from: from, effective_to: to,
  }
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.save_advisory_notice(${groupId}, ${tx.json(p)}, ${tx.json(cleanItems)}, ${reason ?? null}) as id`)
  const [g] = await run(ctx, (tx) => tx<{ g: string }[]>`select notice_group_id as g from advisory_notices where id = ${r.id}`)
  return g.g
}

export async function setRequirementStatus(ctx: Ctx, groupId: string, active: boolean, reason: string) {
  if (!canManageRequirements(ctx)) throw forbidden()
  if (!UUID.test(groupId)) throw notFound()
  return run(ctx, (tx) => tx`select app.set_advisory_status(${groupId}, ${active}, ${reason ?? null})`)
}

/** Students (visible to the user) with notices that still need acknowledgement — for managers and staff. */
export async function pendingAcknowledgements(ctx: Ctx, orgIds: string[], limit = 20) {
  if (!orgIds.length) return []
  return run(ctx, (tx) => tx<{ student_id: string; student_code: string; full_name: string; title: string; priority: string; display_type: string; academic_status: string | null; counsellor: string | null }[]>`
    select s.id as student_id, s.student_code, s.full_name, a.title, a.priority, a.display_type, a.academic_status,
           (select u.full_name from student_assignments x join user_profiles u on u.id = x.user_id where x.student_id = s.id and x.is_active and x.assignment_type = 'counsellor' limit 1) as counsellor
      from v_students s cross join lateral app.student_advisories(s.id) a
     where s.status in ('active', 'on_hold') and (s.originating_org_id = any(${tx.array(orgIds)}::uuid[]) or s.processing_org_id = any(${tx.array(orgIds)}::uuid[]))
       and a.requires_acknowledgement and a.acknowledged_at is null
     order by array_position(array['critical','high','normal','informational'], a.priority), s.full_name limit ${limit}`)
}
