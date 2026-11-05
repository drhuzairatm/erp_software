import { can } from '../lib/auth/context'
import { forbidden, invalid } from '../lib/errors'
import { type Ctx, run } from './base'
import { mdCan } from './master-data'

/** Secondary and tertiary preferences, what applies to each, academic years, and country document rules. All of it advises; none of it blocks. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const opt = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : '')

export interface PreferenceRow { rank: number; country_id: string; university_id: string | null; course_id: string | null; intake_id: string | null; academic_year_id: string | null; country: string; university: string | null; programme: string | null; intake: string | null; academic_year: string | null; updated_at: Date | null }
export interface PreferenceRequirements {
  advisories: { title: string; message: string; priority: string; academic_status: string | null; items: { subject: string; min_percentage: number | null; min_marks: number | null; actual: number | null; result: string }[] | null }[]
  university_documents: { document: string; required: boolean; notes: string | null; conditional: boolean; status: string | null }[]
  country_documents: { document: string; required: boolean; stage: string | null; guidance: string | null; status: string | null; match: 'match' | 'mismatch' | 'unknown' | null }[]
  passport: { rule: string; months: number; status: 'meets' | 'below' | 'missing' }[]
}

export async function studentPreferences(ctx: Ctx, studentId: string) {
  return run(ctx, async (tx) => {
    const [s] = await tx<{ country_id: string | null; university_id: string | null; course_id: string | null; intake_id: string | null; country: string | null; university: string | null; programme: string | null; intake: string | null; visa_country: string | null }[]>`
      select s.destination_country_id as country_id, s.preferred_university_id as university_id, s.course_id, s.intake_id, c.name as country, u.name as university, co.name as programme, i.name as intake, v.name as visa_country
        from students s left join countries c on c.id = s.destination_country_id left join universities u on u.id = s.preferred_university_id left join courses co on co.id = s.course_id left join university_intakes i on i.id = s.intake_id left join countries v on v.id = s.visa_application_country_id where s.id = ${studentId}`
    if (!s) return null
    const others = await tx<PreferenceRow[]>`
      select p.rank, p.country_id, p.university_id, p.course_id, p.intake_id, p.academic_year_id, c.name as country, u.name as university, co.name as programme, i.name as intake, y.code as academic_year, p.updated_at
        from student_preferences p join countries c on c.id = p.country_id left join universities u on u.id = p.university_id left join courses co on co.id = p.course_id left join university_intakes i on i.id = p.intake_id left join academic_years y on y.id = p.academic_year_id
       where p.student_id = ${studentId} order by p.rank`
    const requirements = async (rank: number) => (await tx<{ r: PreferenceRequirements | null }[]>`select app.student_preference_requirements(${studentId}, ${rank}) as r`)[0].r
    const [primaryReq, ...rest] = await Promise.all([requirements(1), ...others.map((o) => requirements(o.rank))])
    const history = await tx<{ id: string; rank: number; action: string; country: string | null; university: string | null; programme: string | null; changed_at: Date; changer: string | null }[]>`
      select h.id, h.rank, h.action, h.country, h.university, h.programme, h.changed_at, u.full_name as changer from student_preference_history h left join user_profiles u on u.id = h.changed_by where h.student_id = ${studentId} order by h.changed_at desc, h.id limit 20`
    const [{ can_edit }] = await tx<{ can_edit: boolean }[]>`select app.can_on_student(${studentId}, 'students.update') as can_edit`
    const years = await tx<{ id: string; code: string }[]>`select id, code from academic_years where is_active order by sort_order, code`
    return { primary: s, primaryRequirements: primaryReq, others: others.map((o, i) => ({ ...o, requirements: rest[i] })), history, canEdit: can_edit, years }
  })
}

export async function savePreference(ctx: Ctx, studentId: string, rank: number, v: Record<string, unknown>) {
  if (!UUID.test(studentId)) throw invalid('Not found.')
  const p = { country_id: opt(v.countryId), university_id: opt(v.universityId), course_id: opt(v.courseId), intake_id: opt(v.intakeId), academic_year_id: opt(v.academicYearId) }
  await run(ctx, (tx) => tx`select app.student_preference_save(${studentId}, ${rank}, ${tx.json(p)})`)
}
export async function clearPreference(ctx: Ctx, studentId: string, rank: number) {
  if (!UUID.test(studentId)) throw invalid('Not found.')
  await run(ctx, (tx) => tx`select app.student_preference_clear(${studentId}, ${rank})`)
}

// ---- academic years
export const canManageYears = (ctx: Ctx) => mdCan(ctx, 'masterdata.status')
export async function listAcademicYears(ctx: Ctx) {
  return run(ctx, (tx) => tx<{ id: string; code: string; sort_order: number; is_active: boolean }[]>`select id, code, sort_order, is_active from academic_years order by sort_order, code`)
}
export async function saveAcademicYear(ctx: Ctx, id: string | null, code: string, sort: number | null, active: boolean | null) {
  if (!canManageYears(ctx)) throw forbidden()
  await run(ctx, (tx) => tx`select app.save_academic_year(${id}, ${code}, ${sort}, ${active})`)
}

// ---- country document rules
export interface CountryRuleRow { id: string; country_id: string; country: string; university_id: string | null; university: string | null; course_id: string | null; course: string | null; document_type_id: string; document: string; stage_key: string | null; stage: string | null; is_required: boolean; match_rule: string | null; guidance: string | null; source_note: string | null; verification_status: string; verified_at: Date | null; verifier: string | null; verification_note: string | null; is_active: boolean }
export const canManageCountryRules = (ctx: Ctx) => can(ctx, 'requirements.manage') || can(ctx, 'requirements.verify')
export const canVerifyCountryRules = (ctx: Ctx) => can(ctx, 'requirements.verify')
export async function listCountryRules(ctx: Ctx) {
  return run(ctx, (tx) => tx<CountryRuleRow[]>`
    select r.*, c.name as country, u.name as university, co.name as course, d.name as document, st.name as stage, v.full_name as verifier
      from country_document_rules r join countries c on c.id = r.country_id join document_types d on d.id = r.document_type_id left join universities u on u.id = r.university_id left join courses co on co.id = r.course_id left join stages st on st.key = r.stage_key left join user_profiles v on v.id = r.verified_by
     order by c.name, d.name, r.id`)
}
export async function saveCountryRule(ctx: Ctx, id: string | null, v: Record<string, unknown>) {
  if (!canManageCountryRules(ctx)) throw forbidden()
  const s = (k: string) => String(v[k] ?? '').trim()
  const p = { country_id: opt(v.countryId), university_id: opt(v.universityId), course_id: opt(v.courseId), document_type_id: opt(v.documentTypeId), stage_key: s('stageKey'), is_required: s('required') !== 'no', match_rule: s('matchRule') === 'visa' ? 'issuing_country_matches_visa_application_country' : '', guidance: s('guidance'), source_note: s('sourceNote') }
  await run(ctx, (tx) => tx`select app.save_country_document_rule(${id}, ${tx.json(p)})`)
}
export async function verifyCountryRule(ctx: Ctx, id: string, verified: boolean, note: string) {
  await run(ctx, (tx) => tx`select app.verify_country_document_rule(${id}, ${verified}, ${note})`)
}
export async function setCountryRuleActive(ctx: Ctx, id: string, active: boolean) {
  await run(ctx, (tx) => tx`select app.set_country_document_rule_active(${id}, ${active})`)
}
