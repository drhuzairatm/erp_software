import { anonymous } from '../db'
import { appUrl } from '../email'
import { can } from '../auth/context'
import { hashToken, newTokenValue } from '../auth/tokens'
import { forbidden, invalid } from '../errors'
import { type Ctx, run } from './base'

const UUID = /^[0-9a-f-]{36}$/i
const opt = (v?: string) => (v && UUID.test(v) ? v : null)
const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null)

export const PASSPORT_TIERS = {
  valid: { label: 'Valid', tone: 'green' },
  warning: { label: 'Expiry warning', tone: 'amber' },
  urgent: { label: 'Urgent renewal required', tone: 'orange' },
  critical: { label: 'Critical', tone: 'red' },
  expired: { label: 'Expired', tone: 'red' },
} as const
export type PassportTier = keyof typeof PASSPORT_TIERS

export const EMAIL_STATUS = {
  entered: { label: 'Not verified', tone: 'slate' },
  pending: { label: 'Verification pending', tone: 'blue' },
  verified: { label: 'Verified', tone: 'green' },
  expired: { label: 'Verification link expired', tone: 'amber' },
  failed: { label: 'Verification email failed', tone: 'red' },
} as const

// ---------------------------------------------------------------- passports
export interface PassportRow {
  id: string; version: number; kind: string; passport_number: string | null; holder_name: string | null; date_of_birth: string | null
  gender: string | null; nationality: string | null; nationality_country_id: string | null; citizenship: string | null; citizenship_country_id: string | null
  issuing_country: string | null; issuing_country_id: string | null; issue_date: string | null; expiry_date: string | null; place_of_issue: string | null
  document_file_id: string | null; notes: string | null; is_current: boolean; created_at: Date; superseded_at: Date | null; created_by_name: string | null; tier: string | null
  verification_status: 'pending' | 'verified' | 'rejected'; verified_at: Date | null; verified_by_name: string | null; verification_note: string | null
}

export async function getPassportData(ctx: Ctx, studentId: string) {
  if (!UUID.test(studentId)) return null
  return run(ctx, async (tx) => {
    const [{ allowed }] = await tx<{ allowed: boolean }[]>`select app.can_on_student(${studentId}, 'students.passport.view') as allowed`
    if (!allowed) return null
    const versions = await tx<PassportRow[]>`
      select p.*, n.name as nationality, c.name as citizenship, i.name as issuing_country, u.full_name as created_by_name, app.passport_tier(p.expiry_date) as tier,
             vu.full_name as verified_by_name
        from student_passports p left join countries n on n.id = p.nationality_country_id left join countries c on c.id = p.citizenship_country_id
        left join countries i on i.id = p.issuing_country_id left join user_profiles u on u.id = p.created_by left join user_profiles vu on vu.id = p.verified_by
       where p.student_id = ${studentId} order by p.version desc`
    const followups = await tx<{ id: string; kind: string; note: string; expected_date: string | null; created_at: Date; author: string | null; passport_version: number | null }[]>`
      select f.id, f.kind, f.note, f.expected_date, f.created_at, u.full_name as author, p.version as passport_version
        from passport_followups f left join user_profiles u on u.id = f.created_by left join student_passports p on p.id = f.passport_id
       where f.student_id = ${studentId} order by f.created_at desc`
    const tasks = await tx<{ id: string; title: string; status: string; due_date: string | null; assignee: string | null }[]>`
      select t.id, t.title, t.status, t.due_date, u.full_name as assignee from tasks t left join user_profiles u on u.id = t.assigned_to
       where t.student_id = ${studentId} and t.task_type = 'passport' order by t.created_at desc limit 20`
    const [{ verify }] = await tx<{ verify: boolean }[]>`select app.can_on_student(${studentId}, 'students.passport.verify') as verify`
    return { current: versions.find((v) => v.is_current) ?? null, pending: versions.find((v) => v.verification_status === 'pending') ?? null,
             canVerify: verify, versions, followups, tasks }
  })
}

export async function recordPassport(ctx: Ctx, studentId: string, v: Record<string, string | undefined>) {
  const kind = v.kind ?? ''
  if (!['initial', 'renewal', 'correction'].includes(kind)) throw invalid('Choose what you are recording.')
  if (v.gender && !['female', 'male', 'other', 'unspecified'].includes(v.gender)) throw invalid('Choose a gender.')
  const number = (v.passportNumber ?? '').toUpperCase().replace(/\s/g, '')
  if (!/^[A-Z0-9]{5,15}$/.test(number)) throw invalid('Passport number: 5–15 letters and digits.', { passportNumber: ['5–15 letters and digits.'] })
  const expiry = date(v.expiryDate)
  if (!expiry) throw invalid('Enter the expiry date.', { expiryDate: ['Required.'] })
  const issue = date(v.issueDate)
  if (issue && issue >= expiry) throw invalid('The issue date must be before the expiry date.', { issueDate: ['Must be before expiry.'] })
  if (v.dateOfBirth && !date(v.dateOfBirth)) throw invalid('Use a valid date of birth.')
  return run(ctx, async (tx) => {
    const [r] = await tx<{ id: string }[]>`select app.record_passport(${studentId}, ${kind}, ${number}, ${v.holderName ?? null}, ${date(v.dateOfBirth)},
      ${v.gender || null}, ${opt(v.nationalityCountryId)}, ${opt(v.citizenshipCountryId)}, ${opt(v.issuingCountryId)}, ${issue}, ${expiry},
      ${v.placeOfIssue ?? null}, ${v.notes ?? null}) as id`
    return r.id
  })
}

/** Verify (activate) or reject a passport that is awaiting verification. */
export async function verifyPassport(ctx: Ctx, passportId: string, decision: string, note?: string) {
  if (!UUID.test(passportId)) throw invalid('Unknown passport.')
  if (decision !== 'verified' && decision !== 'rejected') throw invalid('Choose verify or reject.')
  if (decision === 'rejected' && !note?.trim()) throw invalid('Give the reason for rejecting.', { note: ['Required when rejecting.'] })
  return run(ctx, (tx) => tx`select app.verify_passport(${passportId}, ${decision}, ${note?.trim() || null})`)
}

export async function addPassportFollowup(ctx: Ctx, studentId: string, v: Record<string, string | undefined>) {
  const kind = v.kind ?? ''
  if (!['remark', 'contact', 'commitment', 'received'].includes(kind)) throw invalid('Choose the type of entry.')
  const note = v.note?.trim()
  if (!note) throw invalid('Enter a note.', { note: ['Required.'] })
  const expected = date(v.expectedDate)
  if (kind === 'commitment' && !expected) throw invalid('Enter the date the student expects to have the renewed passport.', { expectedDate: ['Required.'] })
  return run(ctx, async (tx) => {
    const [cur] = await tx<{ id: string }[]>`select id from student_passports where student_id = ${studentId} and is_current`
    await tx`insert into passport_followups (student_id, passport_id, kind, note, expected_date, created_by)
             values (${studentId}, ${cur?.id ?? null}, ${kind}, ${note}, ${expected}, ${ctx.userId})`
  })
}

// ---------------------------------------------------------------- contact history & email verification
export async function getContactHistory(ctx: Ctx, studentId: string) {
  if (!UUID.test(studentId)) return []
  return run(ctx, (tx) => tx<{ id: string; field: string; old_value: string | null; new_value: string | null; country_code: string | null; verification_status: string; changed_at: Date; author: string | null }[]>`
    select h.id::text, h.field, h.old_value, h.new_value, h.country_code, h.verification_status, h.changed_at, u.full_name as author
      from student_contact_changes h left join user_profiles u on u.id = h.changed_by
     where h.student_id = ${studentId} order by h.changed_at desc, h.id desc limit 100`)
}

export async function sendEmailVerification(ctx: Ctx, studentId: string) {
  const token = newTokenValue()
  const link = appUrl(`/verify-email?token=${token}`)
  await run(ctx, (tx) => tx`select app.request_email_verification(${studentId}, ${hashToken(token)}, ${link})`)
}

/** Public: the student opened the link. Returns verified | expired | invalid. */
export async function confirmEmailVerification(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return 'invalid'
  const [r] = await anonymous((tx) => tx<{ r: string }[]>`select app.confirm_email_verification(${hashToken(token)}) as r`)
  return r.r as 'verified' | 'expired' | 'invalid'
}

// ---------------------------------------------------------------- stage requirements & configuration
export const canManagePassportRules = (ctx: Ctx) => can(ctx, 'passport.rules.manage')

export async function listValidityRules(ctx: Ctx) {
  return run(ctx, (tx) => tx<{ id: string; name: string; destination: string | null; university: string | null; course: string | null; stage: string;
    min_months: number; enforcement: string; is_active: boolean; notes: string | null }[]>`
    select r.id, r.name, c.name as destination, u.name as university, co.name as course, st.name as stage, r.min_months, r.enforcement, r.is_active, r.notes
      from passport_validity_rules r join stages st on st.key = r.stage_key left join countries c on c.id = r.destination_country_id
      left join universities u on u.id = r.university_id left join courses co on co.id = r.course_id
     order by r.is_active desc, c.name nulls first, st.sort_order`)
}

export async function addValidityRule(ctx: Ctx, v: Record<string, string | undefined>) {
  if (!canManagePassportRules(ctx)) throw forbidden()
  const name = v.name?.trim()
  if (!name || name.length < 3) throw invalid('Enter a rule name.', { name: ['Required.'] })
  const months = Number(v.minMonths)
  if (!Number.isInteger(months) || months < 0 || months > 120) throw invalid('Minimum validity: 0–120 months.', { minMonths: ['0–120.'] })
  if (!/^[a-z_]+$/.test(v.stageKey ?? '')) throw invalid('Choose the stage.', { stageKey: ['Required.'] })
  if (!['warn', 'block'].includes(v.enforcement ?? '')) throw invalid('Choose warn or block.')
  return run(ctx, (tx) => tx`insert into passport_validity_rules (name, destination_country_id, university_id, course_id, stage_key, min_months, enforcement, notes, created_by)
    values (${name}, ${opt(v.destinationCountryId)}, ${opt(v.universityId)}, ${opt(v.courseId)}, ${v.stageKey!}, ${months}, ${v.enforcement!}, ${v.notes ?? null}, ${ctx.userId})`)
}

export async function setValidityRuleActive(ctx: Ctx, id: string, active: boolean) {
  if (!canManagePassportRules(ctx)) throw forbidden()
  return run(ctx, (tx) => tx`update passport_validity_rules set is_active = ${active} where id = ${id}`)
}

export async function contactRequiredStage(ctx: Ctx) {
  const [r] = await run(ctx, (tx) => tx<{ key: string; name: string }[]>`select key, name from stages where requires_complete_contact order by sort_order limit 1`)
  return r ?? null
}

export async function setContactRequiredStage(ctx: Ctx, stageKey: string | null) {
  if (!canManagePassportRules(ctx)) throw forbidden()
  return run(ctx, (tx) => tx`select app.set_contact_required_stage(${stageKey || null})`)
}
