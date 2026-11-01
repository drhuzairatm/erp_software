import { randomUUID } from 'node:crypto'
import { can, orgsWith } from '../auth/context'
import type { Tx } from '../db'
import { forbidden, invalid, notFound, ServiceError } from '../errors'
import { assignmentSchema, fieldErrors, studentBaseSchema, followupSchema, noteSchema, stageChangeSchema, type StudentInput, studentSchema } from '../validation'
import { type Ctx, PAGE_SIZE, pageOf, run } from './base'

// ---------------------------------------------------------------------------
// Listing & search
// ---------------------------------------------------------------------------
export interface StudentFilters {
  q?: string
  country?: string
  educationCountry?: string
  course?: string
  university?: string
  stage?: string
  status?: string
  assignee?: string
  nextDue?: 'overdue' | 'today' | 'week'
  photo?: 'yes' | 'no'
  archived?: 'yes'
  page?: string | number
  sort?: string
}

const SORTS: Record<string, string> = {
  newest: 's.created_at desc',
  oldest: 's.created_at asc',
  name: 'lower(s.full_name) asc',
  code: 's.student_code asc',
  due: 's.next_action_due asc nulls last',
  stage: 'st.sort_order asc, s.stage_changed_at asc',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuidOrNull = (v?: string) => (v && UUID_RE.test(v) ? v : null)

export async function listStudents(ctx: Ctx, orgIds: string[], f: StudentFilters) {
  const page = pageOf(f.page)
  return run(ctx, async (tx) => {
    const conds = [tx`exists (select 1 from student_org_access a where a.student_id = s.id and a.org_id = any(${tx.array(orgIds)}::uuid[]))`]
    conds.push(f.archived === 'yes' ? tx`s.archived_at is not null` : tx`s.archived_at is null`)
    conds.push(f.status ? tx`s.status = ${f.status}` : tx`s.status <> 'merged'`)
    const q = f.q?.trim().slice(0, 100)
    if (q) {
      const digits = q.replace(/\D/g, '')
      const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`
      conds.push(tx`(s.student_code ilike ${like} or s.full_name ilike ${like}
                     or (${digits.length >= 6} and s.phone_normalized like ${'%' + digits.slice(-10)})
                     or (s.passport_number is not null and s.passport_number = ${q.toUpperCase().replace(/\s/g, '')})
                     or s.email_normalized = ${q.toLowerCase()})`)
    }
    if (uuidOrNull(f.country)) conds.push(tx`s.destination_country_id = ${f.country!}`)
    if (uuidOrNull(f.course)) conds.push(tx`s.course_id = ${f.course!}`)
    if (uuidOrNull(f.educationCountry)) conds.push(tx`s.previous_education_country_id = ${f.educationCountry!}`)
    if (uuidOrNull(f.university)) conds.push(tx`s.preferred_university_id = ${f.university!}`)
    if (f.stage && /^[a-z_]+$/.test(f.stage)) conds.push(tx`s.current_stage_key = ${f.stage}`)
    if (f.assignee === 'me') conds.push(tx`exists (select 1 from student_assignments x where x.student_id = s.id and x.is_active and x.user_id = ${ctx.userId})`)
    else if (f.assignee === 'none') conds.push(tx`not exists (select 1 from student_assignments x where x.student_id = s.id and x.is_active and x.assignment_type <> 'counsellor')`)
    else if (uuidOrNull(f.assignee)) conds.push(tx`exists (select 1 from student_assignments x where x.student_id = s.id and x.is_active and x.user_id = ${f.assignee!})`)
    if (f.photo === 'yes') conds.push(tx`exists (select 1 from student_photos ph where ph.student_id = s.id and ph.is_current)`)
    if (f.photo === 'no') conds.push(tx`not exists (select 1 from student_photos ph where ph.student_id = s.id and ph.is_current)`)
    if (f.nextDue === 'overdue') conds.push(tx`s.next_action_due < current_date and s.status = 'active'`)
    if (f.nextDue === 'today') conds.push(tx`s.next_action_due = current_date`)
    if (f.nextDue === 'week') conds.push(tx`s.next_action_due between current_date and current_date + 7`)
    const where = conds.reduce((a, c) => tx`${a} and ${c}`)
    const order = tx.unsafe(SORTS[f.sort ?? ''] ?? SORTS.newest)
    const rows = await tx<StudentListRow[]>`
      select s.id, s.student_code, s.full_name, s.phone, s.phone_masked, s.contact_visible, s.status, s.current_stage_key,
             st.name as stage_name, s.next_action, s.next_action_due, s.created_at, s.archived_at, s.is_demo,
             o.name as org_name, o.code as org_code, c.name as country_name, co.name as course_name, un.name as university_name,
             (select u.full_name from student_assignments x join user_profiles u on u.id = x.user_id
               where x.student_id = s.id and x.is_active and x.assignment_type = 'counsellor' limit 1) as counsellor_name,
             (select ph.version from student_photos ph where ph.student_id = s.id and ph.is_current) as photo_version,
             count(*) over () as total
        from v_students s
        join stages st on st.key = s.current_stage_key
        join organizations o on o.id = s.originating_org_id
        left join countries c on c.id = s.destination_country_id
        left join courses co on co.id = s.course_id
        left join universities un on un.id = s.preferred_university_id
       where ${where}
       order by ${order}
       limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    return { rows, total: Number(rows[0]?.total ?? 0), page, pageSize: PAGE_SIZE }
  })
}

export interface StudentListRow {
  id: string; student_code: string; full_name: string; phone: string | null; phone_masked: string | null; contact_visible: boolean
  photo_version: number | null
  status: string; current_stage_key: string; stage_name: string; next_action: string | null; next_action_due: string | null
  created_at: Date; archived_at: Date | null; is_demo: boolean; org_name: string; org_code: string; country_name: string | null
  course_name: string | null; university_name: string | null; counsellor_name: string | null; total: string
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export async function getStudent(ctx: Ctx, id: string) {
  if (!UUID_RE.test(id)) return null
  return run(ctx, async (tx) => {
    const [s] = await tx<StudentRecord[]>`
      select s.*, st.name as stage_name, st.kind as stage_kind, o.name as org_name, o.code as org_code,
             po.name as processing_org_name, c.name as country_name, co.name as course_name, un.name as university_name,
             ls.name as lead_source_name, w.name as workflow_name, ce.name as contracting_entity_name, pe.name as payment_recipient_name,
             cu.full_name as created_by_name, uu.full_name as updated_by_name, m.student_code as merged_into_code,
             pec.name as previous_education_country_name, sc.name as school_country_name, pc.name as passport_country_name,
             camp.name as campus_name, vac.name as visa_application_country_name, rc.name as residence_country_name, ink.name as intake_name
        from v_students s
        join stages st on st.key = s.current_stage_key
        join organizations o on o.id = s.originating_org_id
        left join organizations po on po.id = s.processing_org_id
        left join countries c on c.id = s.destination_country_id
        left join courses co on co.id = s.course_id
        left join universities un on un.id = s.preferred_university_id
        left join lead_sources ls on ls.id = s.lead_source_id
        left join workflow_definitions w on w.id = s.workflow_id
        left join legal_entities ce on ce.id = s.contracting_entity_id
        left join legal_entities pe on pe.id = s.payment_recipient_entity_id
        left join user_profiles cu on cu.id = s.created_by
        left join user_profiles uu on uu.id = s.updated_by
        left join students m on m.id = s.merged_into_id
        left join countries pec on pec.id = s.previous_education_country_id
        left join countries sc on sc.id = s.school_country_id
        left join countries pc on pc.id = s.passport_country_id
        left join university_campuses camp on camp.id = s.preferred_campus_id
        left join countries vac on vac.id = s.visa_application_country_id
        left join countries rc on rc.id = s.residence_country_id
        left join university_intakes ink on ink.id = s.intake_id
       where s.id = ${id}`
    if (!s) return null
    const [access, assignments, workflowStages, history] = await Promise.all([
      tx<{ org_id: string; relation: string; org_name: string }[]>`
        select a.org_id, a.relation, o.name as org_name from student_org_access a join organizations o on o.id = a.org_id
         where a.student_id = ${id} order by a.relation`,
      tx<{ id: string; assignment_type: string; user_id: string; full_name: string; org_id: string; assigned_at: Date }[]>`
        select a.id, a.assignment_type, a.user_id, u.full_name, a.org_id, a.assigned_at
          from student_assignments a left join user_profiles u on u.id = a.user_id
         where a.student_id = ${id} and a.is_active order by a.assignment_type`,
      tx<{ stage_key: string; name: string; sort_order: number }[]>`
        select ws.stage_key, st.name, ws.sort_order from workflow_stages ws join stages st on st.key = ws.stage_key
         where ws.workflow_id = ${s.workflow_id} order by ws.sort_order`,
      tx<{ id: string; from_stage: string | null; to_stage: string; from_name: string | null; to_name: string; changed_at: Date;
           changed_by_name: string | null; reason: string | null; next_action: string | null; next_action_due: string | null; warnings: string[] }[]>`
        select h.id, h.from_stage, h.to_stage, fs.name as from_name, ts.name as to_name, h.changed_at, u.full_name as changed_by_name,
               h.reason, h.next_action, h.next_action_due, h.warnings
          from student_stage_history h
          left join stages fs on fs.key = h.from_stage
          join stages ts on ts.key = h.to_stage
          left join user_profiles u on u.id = h.changed_by
         where h.student_id = ${id} order by h.changed_at desc`,
    ])
    const accessOrgIds = [...new Set(access.map((a) => a.org_id))]
    // Status summary (each part only if the user may see it)
    const [docSummary] = await tx<{ required: number; approved: number; rejected: number; awaiting: number }[]>`
      select count(*) filter (where is_required)::int as required,
             count(*) filter (where is_required and status = 'approved' and (expiry_date is null or expiry_date >= current_date))::int as approved,
             count(*) filter (where status in ('rejected', 'changes_required'))::int as rejected,
             count(*) filter (where status in ('uploaded', 'under_review', 'verified', 'pending_approval'))::int as awaiting
        from student_documents where student_id = ${id}`
    const [currentTask] = await tx<{ id: string; title: string; due_date: string | null; assignee: string | null }[]>`
      select t.id, t.title, t.due_date, u.full_name as assignee from tasks t left join user_profiles u on u.id = t.assigned_to
       where t.student_id = ${id} and t.status not in ('completed', 'cancelled')
       order by t.due_date asc nulls last, t.created_at limit 1`
    const balances = await tx<{ ledger: string; currency: string; outstanding: string; pending_receipts: string }[]>`
      select ledger, currency, outstanding, pending_receipts from student_balances where student_id = ${id}`
    const [hasBalance] = await tx<{ outstanding: boolean }[]>`select app.student_has_outstanding_service_balance(${id}) as outstanding`
    const onStudent = (perm: string) => accessOrgIds.some((o) => can(ctx, perm, o))
    const permissions = {
      update: onStudent('students.update') && !s.archived_at && s.status !== 'merged',
      assign: onStudent('students.assign'),
      stageChange: onStudent('students.stage.change') && !s.archived_at && s.status !== 'merged',
      notesRead: onStudent('notes.read'),
      notesWrite: onStudent('notes.write'),
      notesRestricted: onStudent('notes.restricted'),
      documentsRead: onStudent('documents.read'),
      paymentsRead: onStudent('payments.read'),
      tasksCreate: onStudent('tasks.create'),
      merge: can(ctx, 'students.merge', s.originating_org_id),
      archive: can(ctx, 'students.archive', s.originating_org_id),
      visa: onStudent('stage.visa'),
      admission: onStudent('stage.admission'),
      passport: s.passport_visible,
      messages: s.contact_visible,
    }
    const allowedStages = (await tx<{ key: string; name: string; kind: string; permission_key: string }[]>`
      select key, name, kind, permission_key from stages order by sort_order`)
      .filter((st) => st.key !== s.current_stage_key)
      .filter((st) => st.kind === 'hold' || st.kind === 'cancelled' || workflowStages.some((w) => w.stage_key === st.key))
      .filter((st) => onStudent(st.permission_key))
      .filter(() => s.stage_kind === 'normal' || s.stage_kind === 'completed' || onStudent('stage.hold'))
    const paymentStatus = accessOrgIds.some((o) => can(ctx, 'payments.read', o) || can(ctx, 'payments.status', o))
      ? (hasBalance.outstanding ? 'Fees outstanding' : 'No outstanding service fees') : null
    const summary = { documents: docSummary, currentTask: currentTask ?? null, balances, paymentStatus }
    return { student: s, access, accessOrgIds, assignments, workflowStages, history, permissions, allowedStages, summary }
  })
}

export type StudentProfile = NonNullable<Awaited<ReturnType<typeof getStudent>>>

export interface StudentRecord {
  id: string; student_code: string; originating_org_id: string; processing_org_id: string | null; lead_source_id: string | null
  full_name: string; phone: string | null; email: string | null; phone_masked: string | null; email_masked: string | null
  contact_visible: boolean; date_of_birth: string | null; preferred_language: string | null; destination_country_id: string | null
  course_id: string | null; preferred_university_id: string | null; highest_qualification: string | null; qualification_board: string | null
  qualification_year: number | null; qualification_score: string | null; entrance_exam: string | null; entrance_score: string | null
  academic_notes: string | null; registration_date: string | null; workflow_id: string; current_stage_key: string
  stage_before_hold: string | null; stage_changed_at: Date; status: string; next_action: string | null; next_action_due: string | null
  contracting_entity_id: string | null; payment_recipient_entity_id: string | null; university_application_ref: string | null
  admission_letter_date: string | null; visa_appointment_date: string | null; visa_outcome: string; visa_reference: string | null
  merged_into_id: string | null; merged_into_code: string | null; archived_at: Date | null; archive_reason: string | null
  is_demo: boolean; created_by: string; created_at: Date; updated_by: string | null; updated_at: Date
  stage_name: string; stage_kind: string; org_name: string; org_code: string; processing_org_name: string | null
  country_name: string | null; course_name: string | null; university_name: string | null; lead_source_name: string | null
  workflow_name: string | null; contracting_entity_name: string | null; payment_recipient_name: string | null
  created_by_name: string | null; updated_by_name: string | null
  previous_education_country_id: string | null; school_country_id: string | null; institution_name: string | null
  preferred_campus_id: string | null; passport_number: string | null; passport_expiry: string | null; passport_country_id: string | null
  passport_masked: string | null; passport_visible: boolean
  parent_name: string | null; parent_phone: string | null; parent_email: string | null
  visa_application_country_id: string | null; visa_application_country_name: string | null
  phone_country: string | null; phone2: string | null; phone2_country: string | null; phone2_masked: string | null
  phone3: string | null; phone3_country: string | null; phone3_label: string | null
  residence_country_id: string | null; residence_country_name: string | null
  intake_id: string | null; intake_name: string | null
  email_status: 'entered' | 'pending' | 'verified' | 'expired' | 'failed'; email_verified_at: Date | null; passport_status: string | null
  previous_education_country_name: string | null; school_country_name: string | null; passport_country_name: string | null; campus_name: string | null
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------
export interface DuplicateCandidate { student_id: string | null; student_code: string | null; full_name: string | null; org_name: string; matched_on: string; visible: boolean }

export async function findDuplicates(ctx: Ctx, phone?: string, email?: string, excludeId?: string) {
  if (!phone && !email) return []
  return run(ctx, (tx) => tx<DuplicateCandidate[]>`select * from app.find_duplicate_candidates(${phone ?? null}, ${email ?? null}, ${excludeId ?? null})`)
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------
export type CreateResult = { ok: true; id: string } | { ok: false; duplicates: DuplicateCandidate[] }

export async function createStudent(ctx: Ctx, raw: Record<string, unknown>): Promise<CreateResult> {
  const parsed = studentSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Please correct the highlighted fields.', fieldErrors(parsed.error))
  const v = parsed.data
  if (!can(ctx, 'students.create', v.originatingOrgId)) throw forbidden('You cannot register students for this company.')
  if (v.processingOrgId === v.originatingOrgId) v.processingOrgId = undefined
  return run(ctx, async (tx) => {
    if (!v.confirmDuplicate) {
      const dups = await tx<DuplicateCandidate[]>`select * from app.find_duplicate_candidates(${v.phone ?? null}, ${v.email ?? null}, null, ${v.passportNumber ?? null})`
      if (dups.length) return { ok: false as const, duplicates: dups }
    }
    const id = await insertStudent(tx, ctx, v,
      v.confirmDuplicate ? 'Student registered (possible duplicate acknowledged)' : 'Student registered')
    // Consent given on the registration form (only boxes that were ticked; requires notifications.consent)
    const consents = Object.keys(raw).filter((k) => /^consent\.(student|parent)\.(email|whatsapp|sms)$/.test(k) && raw[k] === 'yes')
    if (consents.length) {
      if (!can(ctx, 'notifications.consent', v.originatingOrgId)) throw forbidden('You cannot record message consent.')
      for (const k of consents) {
        const [, recipient, channel] = k.split('.')
        await tx`select app.record_consent(${id}, ${channel}, ${recipient}, true, ${'Registration form'})`
      }
    }
    return { ok: true as const, id }
  })
}

/**
 * Insert a validated student inside an existing transaction: reference checks,
 * the student row (ID generated by the database), counsellor assignment and the
 * timeline event. Shared by the registration form and the CSV import.
 */
export async function insertStudent(tx: Tx, ctx: Ctx, v: StudentInput, eventSummary: string): Promise<string> {
  if (v.processingOrgId === v.originatingOrgId) v.processingOrgId = undefined
  if ((v.passportNumber || v.passportExpiry || v.passportCountryId) && !can(ctx, 'students.passport.view', v.originatingOrgId)) {
    throw forbidden('You do not have permission to record passport details.')
  }
  await validateRefs(tx, v)
  const id = randomUUID()
  await tx`insert into students ${tx(studentColumns(v, id) as never)}`
  // Assign the counsellor: an explicit choice (needs students.assign) or the registering counsellor themselves
  const counsellorId = v.counsellorId ?? (can(ctx, 'stage.sales', v.originatingOrgId) ? ctx.userId : undefined)
  if (counsellorId) {
    if (counsellorId !== ctx.userId && !can(ctx, 'students.assign', v.originatingOrgId)) throw forbidden('You cannot assign other counsellors.')
    await tx`insert into student_assignments (student_id, user_id, org_id, assignment_type, assigned_by)
             values (${id}, ${counsellorId}, ${v.originatingOrgId}, 'counsellor', ${ctx.userId})`
  }
  await tx`select app.add_event(${id}, ${v.originatingOrgId}, 'student', 'registered', ${eventSummary})`
  return id
}

function studentColumns(v: StudentInput, id?: string) {
  const cols: Record<string, unknown> = {
    processing_org_id: v.processingOrgId ?? null,
    lead_source_id: v.leadSourceId ?? null,
    full_name: v.fullName,
    phone: v.phone ?? null,
    phone_country: v.phoneCountry ?? null,
    phone2: v.phone2 ?? null,
    phone2_country: v.phone2Country ?? null,
    phone3: v.phone3 ?? null,
    phone3_country: v.phone3Country ?? null,
    phone3_label: v.phone3Label ?? null,
    residence_country_id: v.residenceCountryId ?? null,
    email: v.email?.toLowerCase() ?? null,
    preferred_language: v.preferredLanguage ?? null,
    date_of_birth: v.dateOfBirth ?? null,
    destination_country_id: v.destinationCountryId ?? null,
    course_id: v.courseId ?? null,
    preferred_university_id: v.preferredUniversityId ?? null,
    highest_qualification: v.highestQualification ?? null,
    qualification_board: v.qualificationBoard ?? null,
    qualification_year: v.qualificationYear ?? null,
    qualification_score: v.qualificationScore ?? null,
    entrance_exam: v.entranceExam ?? null,
    entrance_score: v.entranceScore ?? null,
    academic_notes: v.academicNotes ?? null,
    registration_date: v.registrationDate ?? null,
    next_action: v.nextAction ?? null,
    next_action_due: v.nextActionDue ?? null,
    contracting_entity_id: v.contractingEntityId ?? null,
    payment_recipient_entity_id: v.paymentRecipientEntityId ?? null,
    previous_education_country_id: v.previousEducationCountryId ?? null,
    school_country_id: v.schoolCountryId ?? null,
    institution_name: v.institutionName ?? null,
    preferred_campus_id: v.preferredCampusId ?? null,
    passport_number: v.passportNumber ?? null,
    passport_expiry: v.passportExpiry ?? null,
    passport_country_id: v.passportCountryId ?? null,
    visa_application_country_id: v.visaApplicationCountryId ?? null,
    intake_id: v.intakeId ?? null,
    parent_name: v.parentName ?? null,
    parent_phone: v.parentPhone ?? null,
    parent_email: v.parentEmail?.toLowerCase() ?? null,
  }
  if (id) Object.assign(cols, { id, originating_org_id: v.originatingOrgId })
  return cols
}

async function validateRefs(tx: Tx, v: StudentInput) {
  if (v.preferredUniversityId && v.destinationCountryId) {
    const [u] = await tx`select 1 from universities where id = ${v.preferredUniversityId} and country_id = ${v.destinationCountryId}`
    if (!u) throw invalid('The selected university is not in the selected country.', { preferredUniversityId: ['Choose a university in the destination country.'] })
  }
  if (v.intakeId) {
    const [i] = v.preferredUniversityId ? await tx`select 1 from university_intakes where id = ${v.intakeId} and university_id = ${v.preferredUniversityId}` : []
    if (!i) throw invalid('The selected intake does not belong to the selected university.', { intakeId: ['Choose an intake of the selected university.'] })
  }
  if (v.preferredCampusId) {
    const [c] = v.preferredUniversityId ? await tx`select 1 from university_campuses where id = ${v.preferredCampusId} and university_id = ${v.preferredUniversityId}` : []
    if (!c) throw invalid('The selected campus does not belong to the selected university.', { preferredCampusId: ['Choose a campus of the selected university.'] })
  }
  if (v.leadSourceId) {
    const [l] = await tx`select 1 from lead_sources where id = ${v.leadSourceId} and org_id = ${v.originatingOrgId}`
    if (!l) throw invalid('The lead source does not belong to this company.', { leadSourceId: ['Choose a lead source of this company.'] })
  }
}

const FIELD_LABELS: Record<string, string> = {
  full_name: 'name', phone: 'primary phone', phone2: 'secondary phone', phone3: 'third phone', phone_country: 'primary phone country',
  phone2_country: 'secondary phone country', phone3_country: 'third phone country', phone3_label: 'third phone contact type',
  residence_country_id: 'country of residence', intake_id: 'intake', email: 'email', preferred_language: 'language', date_of_birth: 'date of birth',
  destination_country_id: 'country', course_id: 'course', preferred_university_id: 'university', processing_org_id: 'processing team',
  lead_source_id: 'lead source', registration_date: 'registration date', next_action: 'next action', next_action_due: 'next action due date',
  contracting_entity_id: 'contracting entity', payment_recipient_entity_id: 'payment recipient',
  previous_education_country_id: 'previous education country', school_country_id: 'school country', institution_name: 'institution',
  visa_application_country_id: 'visa application country', passport_number: 'passport number', passport_expiry: 'passport expiry', passport_country_id: 'passport country', preferred_campus_id: 'campus',
}

export async function updateStudent(ctx: Ctx, id: string, raw: Record<string, unknown>) {
  return run(ctx, async (tx) => {
    // Contact fields are only validated and written if the user may see them
    // (otherwise the form cannot show them and they must stay unchanged).
    const [{ pii }] = await tx<{ pii: boolean }[]>`select app.can_on_student(${id}, 'students.contact.view') as pii`
    const parsed = (pii ? studentSchema : studentBaseSchema).safeParse(raw)
    if (!parsed.success) throw invalid('Please correct the highlighted fields.', fieldErrors(parsed.error))
    const v = parsed.data
    const [cur] = await tx<{ originating_org_id: string; workflow_id: string; destination_country_id: string | null; course_id: string | null }[]>`
      select originating_org_id, workflow_id, destination_country_id, course_id from v_students where id = ${id}`
    if (!cur) throw notFound()
    v.originatingOrgId = cur.originating_org_id // the originating brand cannot be changed here
    if (v.processingOrgId === cur.originating_org_id) v.processingOrgId = undefined
    await validateRefs(tx, v)
    const cols = studentColumns(v)
    if (!pii) {
      for (const k of ['phone', 'phone_country', 'phone2', 'phone2_country', 'phone3', 'phone3_country', 'phone3_label']) delete cols[k]
      delete cols.email
      delete cols.date_of_birth
      delete cols.parent_phone
      delete cols.parent_email
    }
    const [{ pass }] = await tx<{ pass: boolean }[]>`select app.can_on_student(${id}, 'students.passport.view') as pass`
    if (!pass) {
      delete cols.passport_number
      delete cols.passport_expiry
      delete cols.passport_country_id
    }
    const before = (await tx`select * from v_students where id = ${id}`)[0] as Record<string, unknown>
    const res = await tx`update students set ${tx(cols as never)} where id = ${id}`
    if (res.count === 0) throw forbidden('You cannot edit this student.')
    const changed = Object.keys(cols).filter((k) => String(before[k] ?? '') !== String(cols[k] ?? ''))
    // Country/course change → re-pick workflow and add any newly required documents
    if (v.destinationCountryId !== (cur.destination_country_id ?? undefined) || v.courseId !== (cur.course_id ?? undefined)) {
      const [{ wf }] = await tx<{ wf: string }[]>`select app.pick_workflow(${v.destinationCountryId ?? null}, ${v.courseId ?? null}) as wf`
      if (wf && wf !== cur.workflow_id) {
        await tx`update students set workflow_id = ${wf} where id = ${id}`
        await tx`select app.ensure_document_checklist(${id})`
        changed.push('workflow')
      }
    }
    if (changed.length) {
      await tx`select app.add_event(${id}, ${cur.originating_org_id}, 'student', 'updated',
                ${'Details updated: ' + changed.map((c) => FIELD_LABELS[c] ?? c.replace(/_/g, ' ')).join(', ')})`
    }
    return { changed }
  })
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------
export async function setAssignment(ctx: Ctx, studentId: string, raw: Record<string, unknown>) {
  const parsed = assignmentSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Invalid assignment.', fieldErrors(parsed.error))
  const { assignmentType, userId, orgId } = parsed.data
  return run(ctx, async (tx) => {
    const [ok] = await tx<{ ok: boolean }[]>`select app.can_on_student(${studentId}, 'students.assign') as ok`
    if (!ok?.ok) throw forbidden('You cannot assign staff to this student.')
    const prev = await tx<{ id: string; user_id: string; full_name: string }[]>`
      select a.id, a.user_id, u.full_name from student_assignments a join user_profiles u on u.id = a.user_id
       where a.student_id = ${studentId} and a.assignment_type = ${assignmentType} and a.is_active`
    if (prev[0]?.user_id === userId) return // no change
    if (!prev[0] && !userId) return
    await tx`update student_assignments set is_active = false, ended_at = now(), ended_by = ${ctx.userId}
              where student_id = ${studentId} and assignment_type = ${assignmentType} and is_active`
    let name = 'nobody'
    if (userId) {
      await tx`insert into student_assignments (student_id, user_id, org_id, assignment_type, assigned_by)
               values (${studentId}, ${userId}, ${orgId}, ${assignmentType}, ${ctx.userId})`
      ;[{ full_name: name }] = await tx<{ full_name: string }[]>`select full_name from user_profiles where id = ${userId}`
    }
    await tx`select app.add_event(${studentId}, ${orgId}, 'assignment', 'assigned',
              ${`${assignmentType[0].toUpperCase() + assignmentType.slice(1)} assigned: ${prev[0] ? prev[0].full_name + ' → ' : ''}${name}`})`
  })
}

/** Staff who could be assigned to this student (active members of companies with access). */
export async function assignableStaff(ctx: Ctx, studentId: string) {
  return run(ctx, (tx) => tx<{ id: string; full_name: string; org_id: string; org_name: string; role_name: string; role_key: string }[]>`
    select distinct u.id, u.full_name, m.org_id, o.name as org_name, r.name as role_name, r.key as role_key
      from student_org_access a
      join organization_memberships m on m.org_id = a.org_id and m.is_active
      join user_profiles u on u.id = m.user_id and u.is_active
      join roles r on r.id = m.role_id
      join organizations o on o.id = m.org_id
     where a.student_id = ${studentId}
     order by u.full_name`)
}

// ---------------------------------------------------------------------------
// Stage transitions
// ---------------------------------------------------------------------------
const DOC_GATED = ['attestation', 'translation', 'university_application', 'admission_letter', 'visa_processing']

export async function stageWarnings(tx: Tx, studentId: string, toStage: string): Promise<string[]> {
  const [s] = await tx<{ current_stage_key: string; admission_letter_date: string | null; visa_outcome: string; cur_order: number; cur_kind: string; to_order: number; to_kind: string }[]>`
    select s.current_stage_key, s.admission_letter_date, s.visa_outcome, cs.sort_order as cur_order, cs.kind as cur_kind, ts.sort_order as to_order, ts.kind as to_kind
      from v_students s join stages cs on cs.key = s.current_stage_key join stages ts on ts.key = ${toStage}
     where s.id = ${studentId}`
  if (!s) return []
  const w: string[] = []
  if (s.cur_kind === 'normal' && s.to_kind === 'normal' && s.to_order < s.cur_order) w.push('This moves the student back to an earlier stage.')
  const [docs] = await tx<{ uploaded: number; required_not_approved: number; rejected: number }[]>`
    select count(*) filter (where current_file_id is not null)::int as uploaded,
           count(*) filter (where is_required and (status <> 'approved' or (expiry_date is not null and expiry_date < current_date)))::int as required_not_approved,
           count(*) filter (where status in ('rejected', 'changes_required'))::int as rejected
      from student_documents where student_id = ${studentId}`
  if (toStage === 'document_review' && docs.uploaded === 0) w.push('No documents have been uploaded yet.')
  if (DOC_GATED.includes(toStage) && docs.required_not_approved > 0)
    w.push(`${docs.required_not_approved} required document(s) are not yet approved (or have expired).`)
  if (DOC_GATED.includes(toStage) && docs.rejected > 0) w.push(`${docs.rejected} document(s) are rejected and awaiting resubmission.`)
  if (toStage === 'visa_processing' && !s.admission_letter_date) w.push('No admission letter date is recorded.')
  if (['travel_preparation', 'travel_completed'].includes(toStage) && s.visa_outcome !== 'approved') w.push('The visa outcome is not recorded as approved.')
  if (s.cur_kind !== 'normal' || s.to_order > s.cur_order) {
    const issues = await tx<{ kind: string; enforcement: string; message: string }[]>`select * from app.stage_requirement_issues(${studentId}, ${toStage})`
    const blocking = issues.filter((i) => i.enforcement === 'block')
    if (blocking.length) throw invalid(blocking.map((i) => i.message).join(' · '))
    for (const i of issues) w.push(i.message)
  }
  if (['travel_preparation', 'travel_completed'].includes(toStage)) {
    const [{ outstanding }] = await tx<{ outstanding: boolean }[]>`select app.student_has_outstanding_service_balance(${studentId}) as outstanding`
    if (outstanding) w.push('The student has an outstanding service-fee balance.')
  }
  return w
}

export type StageChangeResult = { ok: true } | { ok: false; warnings: string[] }

export async function changeStage(ctx: Ctx, studentId: string, raw: Record<string, unknown>): Promise<StageChangeResult> {
  const parsed = stageChangeSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Please correct the highlighted fields.', fieldErrors(parsed.error))
  const v = parsed.data
  return run(ctx, async (tx) => {
    // permission first, so a user without access is told so (not about missing data)
    const [{ allowed }] = await tx<{ allowed: boolean }[]>`
      select coalesce(app.can_on_student(${studentId}, (select permission_key from stages where key = ${v.toStage})), false) as allowed`
    if (!allowed) throw forbidden('You do not have permission to move students to this stage.')
    const warnings = await stageWarnings(tx, studentId, v.toStage)
    if (warnings.length && !v.acknowledge) return { ok: false as const, warnings }
    await tx`select app.change_student_stage(${studentId}, ${v.toStage}, ${v.reason ?? null}, ${v.nextAction ?? null},
                                               ${v.nextActionDue ?? null}, ${tx.json(warnings)})`
    return { ok: true as const }
  })
}

export async function updateVisaDetails(ctx: Ctx, studentId: string, raw: Record<string, string | undefined>) {
  const outcome = raw.visaOutcome ?? 'not_applied'
  if (!['not_applied', 'pending', 'approved', 'rejected'].includes(outcome)) throw invalid('Invalid visa outcome.')
  const date = raw.visaAppointmentDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.visaAppointmentDate) ? raw.visaAppointmentDate : null
  return run(ctx, (tx) => tx`select app.update_visa_details(${studentId}, ${date}, ${outcome}, ${(raw.visaReference ?? '').slice(0, 100)})`)
}

export async function updateAdmissionDetails(ctx: Ctx, studentId: string, raw: Record<string, string | undefined>) {
  const date = raw.admissionLetterDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.admissionLetterDate) ? raw.admissionLetterDate : null
  return run(ctx, (tx) => tx`select app.update_admission_details(${studentId}, ${(raw.universityApplicationRef ?? '').slice(0, 100)}, ${date})`)
}

// ---------------------------------------------------------------------------
// Notes, follow-ups, timeline
// ---------------------------------------------------------------------------
export async function addNote(ctx: Ctx, studentId: string, raw: Record<string, unknown>) {
  const parsed = noteSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Please write a note.', fieldErrors(parsed.error))
  const v = parsed.data
  return run(ctx, async (tx) => {
    await tx`insert into student_notes (student_id, org_id, visibility, body, created_by)
             values (${studentId}, ${v.orgId}, ${v.visibility}, ${v.body}, ${ctx.userId})`
    await tx`select app.add_event(${studentId}, ${v.orgId}, 'note', 'note', ${v.visibility === 'restricted' ? 'Restricted note added' : 'Internal note added'})`
  })
}

export async function addFollowup(ctx: Ctx, studentId: string, raw: Record<string, unknown>) {
  const parsed = followupSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Please correct the highlighted fields.', fieldErrors(parsed.error))
  const v = parsed.data
  return run(ctx, async (tx) => {
    await tx`insert into followups (student_id, org_id, channel, summary, next_followup_date, created_by)
             values (${studentId}, ${v.orgId}, ${v.channel}, ${v.summary}, ${v.nextFollowupDate ?? null}, ${ctx.userId})`
    if (v.nextFollowupDate) {
      await tx`update students set next_action = 'Follow up with student', next_action_due = ${v.nextFollowupDate} where id = ${studentId}`
    }
    await tx`select app.add_event(${studentId}, ${v.orgId}, 'followup', 'followup', ${'Follow-up logged (' + v.channel.replace('_', ' ') + ')'})`
  })
}

export async function getNotes(ctx: Ctx, studentId: string) {
  return run(ctx, async (tx) => ({
    notes: await tx<{ id: string; body: string; visibility: string; created_at: Date; author: string | null; org_name: string }[]>`
      select n.id, n.body, n.visibility, n.created_at, u.full_name as author, o.name as org_name
        from student_notes n left join user_profiles u on u.id = n.created_by join organizations o on o.id = n.org_id
       where n.student_id = ${studentId} order by n.created_at desc limit 200`,
    followups: await tx<{ id: string; channel: string; summary: string; occurred_at: Date; next_followup_date: string | null; author: string | null }[]>`
      select f.id, f.channel, f.summary, f.occurred_at, f.next_followup_date, u.full_name as author
        from followups f left join user_profiles u on u.id = f.created_by
       where f.student_id = ${studentId} order by f.occurred_at desc limit 200`,
  }))
}

export async function getTimeline(ctx: Ctx, studentId: string) {
  return run(ctx, (tx) => tx<{ id: string; category: string; event_type: string; summary: string; occurred_at: Date; actor: string | null }[]>`
    select e.id, e.category, e.event_type, e.summary, e.occurred_at, u.full_name as actor
      from student_events e left join user_profiles u on u.id = e.actor_user_id
     where e.student_id = ${studentId}
        or e.student_id in (select merged_student_id from student_merges where surviving_student_id = ${studentId})
     order by e.occurred_at desc, e.id desc limit 500`)
}

// ---------------------------------------------------------------------------
// Merge & archive
// ---------------------------------------------------------------------------
export async function mergeStudents(ctx: Ctx, survivingId: string, mergedCode: string, reason: string) {
  if (!reason?.trim()) throw invalid('Give a reason for the merge.', { reason: ['Required.'] })
  return run(ctx, async (tx) => {
    const [m] = await tx<{ id: string }[]>`select id from v_students where student_code = ${mergedCode.trim().toUpperCase()}`
    if (!m) throw notFound('No student with that Student ID is visible to you.')
    await tx`select app.merge_students(${survivingId}, ${m.id}, ${reason.trim()})`
  })
}

export async function setArchived(ctx: Ctx, id: string, archived: boolean, reason?: string) {
  return run(ctx, (tx) => tx`select app.set_student_archived(${id}, ${archived}, ${reason ?? null})`)
}

export function canRegisterIn(ctx: Ctx) {
  return orgsWith(ctx, 'students.create')
}

export { ServiceError }
