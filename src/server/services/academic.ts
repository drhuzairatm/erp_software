import { randomUUID } from 'node:crypto'
import { can } from '../auth/context'
import { forbidden, invalid, notFound } from '../errors'
import { type Ctx, run } from './base'

const UUID = /^[0-9a-f-]{36}$/i
const opt = (v?: string | null) => (v && UUID.test(v) ? v : null)
const str = (v?: string | null, max = 200) => (v && v.trim() ? v.trim().slice(0, max) : null)
const date = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null)
function num(v: string | null | undefined, label: string, max?: number) {
  if (v == null || v.trim() === '') return null
  const n = Number(v.trim())
  if (!Number.isFinite(n) || n < 0 || (max !== undefined && n > max)) throw invalid(`${label}: enter a number${max !== undefined ? ` from 0 to ${max}` : ''}.`)
  return n
}

export const RECORD_KINDS = {
  class_10: 'Class 10 / Secondary', plus_two: 'Plus Two / Higher Secondary (Class 12)', bachelor: "Bachelor's degree",
  mbbs: 'MBBS degree', internship: 'Internship', medical_registration: 'Medical registration', other: 'Other qualification',
} as const
export type RecordKind = keyof typeof RECORD_KINDS
export const GRADING_SYSTEMS = { percentage: 'Percentage', marks: 'Marks (obtained / total)', cgpa_10: 'CGPA (out of 10)', cgpa_4: 'GPA (out of 4)', letter_grade: 'Letter grades', other: 'Other' } as const
export const SUBJECT_KEYS = { physics: 'Physics', chemistry: 'Chemistry', biology: 'Biology', mathematics: 'Mathematics', english: 'English', other: 'Other subject' } as const
export const MISMATCH_LABELS: Record<string, string> = {
  spelling: 'Spelling difference', initials: 'Initials instead of full name', missing_surname: 'Surname missing', missing_middle_name: 'Middle name missing',
  name_order: 'Different name order', extra_name: 'Extra name on certificate', spacing: 'Spacing difference', other: 'Other difference',
}
export const OAS_STATUS: Record<string, { label: string; tone: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'purple' }> = {
  recommended: { label: 'Recommended', tone: 'blue' }, mandatory: { label: 'Mandatory', tone: 'red' }, pending: { label: 'Pending (requested)', tone: 'amber' },
  received: { label: 'Received', tone: 'purple' }, verified: { label: 'Verified', tone: 'blue' }, approved: { label: 'Approved', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
}

export interface SubjectRow { id: string; record_id: string; subject_key: string; subject_name: string; max_marks: string | null; marks_obtained: string | null; percentage: string | null; grade: string | null; pct: string | null }
export interface RecordRow {
  id: string; kind: RecordKind; title: string | null; name_on_certificate: string | null; certificate_number: string | null; register_number: string | null
  board: string | null; institution_name: string | null; institution_country_id: string | null; institution_country: string | null
  issuing_country_id: string | null; issuing_country: string | null; year_of_passing: number | null; stream: string | null; grading_system: string | null
  total_marks: string | null; marks_obtained: string | null; percentage: string | null; cgpa: string | null; grade: string | null; pct: string | null
  issue_date: string | null; start_date: string | null; end_date: string | null; registration_authority: string | null; registration_number: string | null
  registration_valid_until: string | null; notes: string | null; updated_at: Date; updated_by_name: string | null
}

export async function getAcademic(ctx: Ctx, studentId: string) {
  if (!UUID.test(studentId)) return null
  return run(ctx, async (tx) => {
    const [s] = await tx<{ id: string; academic_profile: string; course: string | null; holder_name: string | null }[]>`
      select s.id, coalesce(c.academic_profile, 'school') as academic_profile, c.name as course,
             (select p.holder_name from student_passports p where p.student_id = s.id and p.is_current) as holder_name
        from v_students s left join courses c on c.id = s.course_id where s.id = ${studentId}`
    if (!s) return null
    const records = await tx<RecordRow[]>`
      select r.*, ic.name as institution_country, isc.name as issuing_country, app.pct(r.percentage, r.marks_obtained, r.total_marks)::text as pct,
             u.full_name as updated_by_name
        from academic_records r left join countries ic on ic.id = r.institution_country_id left join countries isc on isc.id = r.issuing_country_id
        left join user_profiles u on u.id = r.updated_by
       where r.student_id = ${studentId}
       order by array_position(array['class_10','plus_two','bachelor','mbbs','internship','medical_registration','other'], r.kind), r.created_at`
    const subjects = records.length ? await tx<SubjectRow[]>`
      select x.*, app.pct(x.percentage, x.marks_obtained, x.max_marks)::text as pct from academic_subjects x
       where x.record_id = any(${tx.array(records.map((r) => r.id))}::uuid[]) order by x.sort_order, x.subject_name` : []
    const eligibility = await tx<{ threshold_id: string; name: string; record_kind: string; subject_key: string; min_percentage: string; actual: string | null; result: string }[]>`
      select threshold_id, name, record_kind, subject_key, min_percentage::text, actual::text, result from app.academic_eligibility(${studentId})`
    const checks = await tx<{ id: string; record_kind: string; passport_name: string; certificate_name: string; mismatch_types: string[]; review_status: string;
      review_note: string | null; reviewer: string | null; reviewed_at: Date | null; requirement: string | null; case_id: string | null; case_status: string | null
      template_id: string | null; preview_text: string | null; requested_at: Date | null; request_channel: string | null; request_note: string | null
      cancel_reason: string | null; student_document_id: string | null }[]>`
      select c.id, c.record_kind, c.passport_name, c.certificate_name, c.mismatch_types, c.review_status, c.review_note, u.full_name as reviewer, c.reviewed_at,
             coalesce(k.requirement, (select q.requirement from app.one_and_same_requirement(c.id) q)) as requirement,
             k.id as case_id, case when k.id is not null then app.one_and_same_status(k.id) end as case_status, k.template_id, k.preview_text,
             k.requested_at, k.request_channel, k.request_note, k.cancel_reason, k.student_document_id
        from name_checks c left join one_and_same_cases k on k.name_check_id = c.id left join user_profiles u on u.id = c.reviewed_by
       where c.student_id = ${studentId} and c.is_current order by c.created_at`
    const templates = await tx<{ id: string; name: string }[]>`select id, name from one_and_same_templates where status = 'approved' order by name`
    const [perms] = await tx<{ edit: boolean; review: boolean; approve: boolean }[]>`
      select app.can_on_student(${studentId}, 'students.update') as edit, app.can_on_student(${studentId}, 'documents.review') as review,
             app.can_on_student(${studentId}, 'documents.approve') as approve`
    return { profile: s.academic_profile as 'school' | 'pg_medical', course: s.course, holderName: s.holder_name, records, subjects, eligibility, checks, templates, perms }
  })
}

const KIND_SET = new Set(Object.keys(RECORD_KINDS))
const GRADING_SET = new Set(Object.keys(GRADING_SYSTEMS))

export interface SubjectInput { key?: string; name?: string; max?: string; obtained?: string; pct?: string; grade?: string }

/** Create or update an academic record and replace its subjects. */
export async function saveRecord(ctx: Ctx, studentId: string, recordId: string | null, v: Record<string, string | undefined>, subjects: SubjectInput[]) {
  const kind = v.kind ?? ''
  if (!KIND_SET.has(kind)) throw invalid('Choose the type of qualification.')
  if (v.gradingSystem && !GRADING_SET.has(v.gradingSystem)) throw invalid('Choose the grading system.')
  const year = num(v.yearOfPassing, 'Year of passing')
  if (year !== null && (year < 1950 || year > 2100)) throw invalid('Year of passing: 1950–2100.', { yearOfPassing: ['1950–2100.'] })
  const total = num(v.totalMarks, 'Total marks'); const obtained = num(v.marksObtained, 'Marks obtained')
  if (total !== null && obtained !== null && obtained > total) throw invalid('Marks obtained cannot be more than the total.', { marksObtained: ['More than total.'] })
  const cols = {
    kind, title: str(v.title, 120), name_on_certificate: str(v.nameOnCertificate), certificate_number: str(v.certificateNumber, 60), register_number: str(v.registerNumber, 60),
    board: str(v.board, 160), institution_name: str(v.institutionName), institution_country_id: opt(v.institutionCountryId), issuing_country_id: opt(v.issuingCountryId),
    year_of_passing: year, stream: str(v.stream, 80), grading_system: v.gradingSystem || null, total_marks: total, marks_obtained: obtained,
    percentage: num(v.percentage, 'Percentage', 100), cgpa: num(v.cgpa, 'CGPA', 10), grade: str(v.grade, 20), issue_date: date(v.issueDate),
    start_date: date(v.startDate), end_date: date(v.endDate), registration_authority: str(v.registrationAuthority, 160), registration_number: str(v.registrationNumber, 60),
    registration_valid_until: date(v.registrationValidUntil), notes: str(v.notes, 2000),
  }
  const subs = subjects.filter((x) => x.name?.trim()).map((x, i) => {
    const max = num(x.max, `${x.name} maximum marks`); const got = num(x.obtained, `${x.name} marks`)
    if (max !== null && got !== null && got > max) throw invalid(`${x.name}: marks obtained cannot be more than the maximum.`)
    return { subject_key: x.key && x.key in SUBJECT_KEYS ? x.key : 'other', subject_name: x.name!.trim().slice(0, 80), max_marks: max, marks_obtained: got,
      percentage: num(x.pct, `${x.name} percentage`, 100), grade: str(x.grade, 20), sort_order: (i + 1) * 10 }
  })
  return run(ctx, async (tx) => {
    let id = recordId
    if (id) {
      const r = await tx`update academic_records set ${tx(cols as never)} where id = ${id} and student_id = ${studentId}`
      if (!r.count) throw forbidden('You cannot edit this record.')
      await tx`delete from academic_subjects where record_id = ${id}`
    } else {
      id = randomUUID()
      await tx`insert into academic_records ${tx({ id, student_id: studentId, created_by: ctx.userId, ...cols } as never)}`
    }
    for (const x of subs) await tx`insert into academic_subjects ${tx({ record_id: id, ...x } as never)}`
    await tx`select app.add_event(${studentId}, null, 'student', 'academic_record', ${(recordId ? 'Academic record updated: ' : 'Academic record added: ') + RECORD_KINDS[kind as RecordKind]})`
    return id
  })
}

export async function deleteRecord(ctx: Ctx, studentId: string, recordId: string) {
  return run(ctx, async (tx) => {
    if ((await tx`select 1 from one_and_same_cases k join name_checks c on c.id = k.name_check_id where c.academic_record_id = ${recordId}`).length) {
      throw invalid('This record has a One and Same case; it cannot be deleted.')
    }
    const r = await tx`delete from academic_records where id = ${recordId} and student_id = ${studentId}`
    if (!r.count) throw notFound()
    await tx`select app.add_event(${studentId}, null, 'student', 'academic_record', 'Academic record removed')`
  })
}

export async function reviewNameCheck(ctx: Ctx, checkId: string, decision: string, note?: string) {
  return run(ctx, (tx) => tx`select app.review_name_check(${checkId}, ${decision}, ${note ?? null})`)
}
export async function prepareOneAndSame(ctx: Ctx, caseId: string, templateId: string) {
  if (!UUID.test(templateId)) throw invalid('Choose a template.')
  return run(ctx, (tx) => tx`select app.prepare_one_and_same(${caseId}, ${templateId})`)
}
export async function requestOneAndSame(ctx: Ctx, caseId: string, channel: string, note?: string) {
  const [r] = await run(ctx, (tx) => tx<{ n: number }[]>`select app.request_one_and_same(${caseId}, ${channel}, ${note ?? null}) as n`)
  return r.n
}
export async function cancelOneAndSame(ctx: Ctx, caseId: string, reason: string) {
  return run(ctx, (tx) => tx`select app.cancel_one_and_same(${caseId}, ${reason ?? null})`)
}

// ------------------------------------------------------------------ configuration
export const canManageAcademicRules = (ctx: Ctx) => can(ctx, 'academic.rules.manage')
export const canApproveTemplates = (ctx: Ctx) => can(ctx, 'one_and_same.templates.approve')

export async function academicConfig(ctx: Ctx) {
  return run(ctx, async (tx) => {
    const thresholds = await tx<{ id: string; name: string; destination: string | null; university: string | null; course: string | null; intake: string | null
      grading_system: string | null; record_kind: string; subject_key: string; min_percentage: string; is_active: boolean; source_note: string | null }[]>`
      select t.id, t.name, c.name as destination, u.name as university, co.name as course, i.name as intake, t.grading_system, t.record_kind, t.subject_key,
             t.min_percentage::text, t.is_active, t.source_note
        from academic_thresholds t left join countries c on c.id = t.destination_country_id left join universities u on u.id = t.university_id
        left join courses co on co.id = t.course_id left join university_intakes i on i.id = t.intake_id
       order by t.is_active desc, t.name, t.subject_key`
    const rules = await tx<{ id: string; name: string; destination: string | null; university: string | null; course: string | null; record_kind: string | null
      mismatch_type: string | null; requirement: string; is_active: boolean; notes: string | null }[]>`
      select r.id, r.name, c.name as destination, u.name as university, co.name as course, r.record_kind, r.mismatch_type, r.requirement, r.is_active, r.notes
        from one_and_same_rules r left join countries c on c.id = r.destination_country_id left join universities u on u.id = r.university_id
        left join courses co on co.id = r.course_id order by r.is_active desc, r.name`
    const templates = await tx<{ id: string; name: string; body: string; status: string; approved_by_name: string | null; approved_at: Date | null }[]>`
      select t.id, t.name, t.body, t.status, u.full_name as approved_by_name, t.approved_at from one_and_same_templates t
        left join user_profiles u on u.id = t.approved_by order by array_position(array['approved','draft','retired'], t.status), t.name`
    const stages = await tx<{ key: string; name: string; academic_check: string }[]>`select key, name, academic_check from stages where kind = 'normal' order by sort_order`
    return { thresholds, rules, templates, stages }
  })
}

function guard(ctx: Ctx) { if (!canManageAcademicRules(ctx)) throw forbidden() }

export async function addThreshold(ctx: Ctx, v: Record<string, string | undefined>) {
  guard(ctx)
  const name = str(v.name, 160)
  if (!name || name.length < 3) throw invalid('Enter a name.', { name: ['Required.'] })
  if (!['overall', ...Object.keys(SUBJECT_KEYS).filter((k) => k !== 'other')].includes(v.subjectKey ?? '')) throw invalid('Choose the subject.')
  if (!['class_10', 'plus_two', 'bachelor', 'mbbs'].includes(v.recordKind ?? '')) throw invalid('Choose the qualification.')
  const min = num(v.minPercentage, 'Minimum percentage', 100)
  if (min === null) throw invalid('Enter the minimum percentage.', { minPercentage: ['Required.'] })
  return run(ctx, (tx) => tx`insert into academic_thresholds (name, destination_country_id, university_id, course_id, intake_id, grading_system, record_kind, subject_key, min_percentage, source_note, created_by)
    values (${name}, ${opt(v.destinationCountryId)}, ${opt(v.universityId)}, ${opt(v.courseId)}, ${opt(v.intakeId)}, ${v.gradingSystem && GRADING_SET.has(v.gradingSystem) ? v.gradingSystem : null},
            ${v.recordKind!}, ${v.subjectKey!}, ${min}, ${str(v.sourceNote, 500)}, ${ctx.userId})`)
}
export async function toggleThreshold(ctx: Ctx, id: string, active: boolean) {
  guard(ctx)
  return run(ctx, (tx) => tx`update academic_thresholds set is_active = ${active} where id = ${id}`)
}
export async function addOasRule(ctx: Ctx, v: Record<string, string | undefined>) {
  guard(ctx)
  const name = str(v.name, 160)
  if (!name || name.length < 3) throw invalid('Enter a name.', { name: ['Required.'] })
  if (!['recommended', 'mandatory'].includes(v.requirement ?? '')) throw invalid('Choose Recommended or Mandatory.')
  if (v.recordKind && !KIND_SET.has(v.recordKind)) throw invalid('Choose the document.')
  if (v.mismatchType && !(v.mismatchType in MISMATCH_LABELS)) throw invalid('Choose the type of difference.')
  return run(ctx, (tx) => tx`insert into one_and_same_rules (name, destination_country_id, university_id, course_id, record_kind, mismatch_type, requirement, notes, created_by)
    values (${name}, ${opt(v.destinationCountryId)}, ${opt(v.universityId)}, ${opt(v.courseId)}, ${v.recordKind || null}, ${v.mismatchType || null}, ${v.requirement!}, ${str(v.notes, 500)}, ${ctx.userId})`)
}
export async function toggleOasRule(ctx: Ctx, id: string, active: boolean) {
  guard(ctx)
  return run(ctx, (tx) => tx`update one_and_same_rules set is_active = ${active} where id = ${id}`)
}
export async function addTemplate(ctx: Ctx, v: Record<string, string | undefined>) {
  guard(ctx)
  const name = str(v.name, 160); const body = v.body?.trim()
  if (!name || name.length < 3) throw invalid('Enter a name.', { name: ['Required.'] })
  if (!body || body.length < 20) throw invalid('Enter the wording (at least 20 characters).', { body: ['Required.'] })
  return run(ctx, (tx) => tx`insert into one_and_same_templates (name, body, created_by) values (${name}, ${body.slice(0, 6000)}, ${ctx.userId})`)
}
export async function approveTemplate(ctx: Ctx, id: string) {
  if (!canApproveTemplates(ctx)) throw forbidden('Only a manager or the MD can approve templates.')
  return run(ctx, (tx) => tx`select app.approve_one_and_same_template(${id})`)
}
export async function retireTemplate(ctx: Ctx, id: string) {
  if (!canApproveTemplates(ctx)) throw forbidden()
  return run(ctx, (tx) => tx`select app.retire_one_and_same_template(${id})`)
}
export async function setAcademicCheck(ctx: Ctx, stageKey: string, check: string) {
  guard(ctx)
  if (!['none', 'warn', 'block'].includes(check)) throw invalid('Choose none, warn or block.')
  return run(ctx, (tx) => tx`select app.set_academic_check(${stageKey}, ${check})`)
}
