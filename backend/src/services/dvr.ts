import { orgsWith } from '../lib/auth/context'
import { invalid, notFound } from '../lib/errors'
import { PAGE_SIZE, type Ctx, pageOf, run } from './base'
import { uploadSecureFile } from './secure-files'

/** Pre-admission document verification. Row-level security limits reads; every change goes through a database function that checks permission and status. Creates no student. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const need = (id: unknown) => { if (typeof id !== 'string' || !UUID_RE.test(id)) throw notFound('Not found.'); return id }

export const DVR_STATUSES = ['draft', 'new_request', 'assigned', 'under_verification', 'additional_documents_required', 'correction_required', 'pending_further_review', 'verification_completed', 'returned_to_counselor', 'resubmitted', 'closed', 'cancelled'] as const
export const DVR_DOC_RESULTS = ['verified', 'not_acceptable', 'correction_required', 'missing_document', 'additional_clarification_required'] as const
export const DVR_OVERALL = ['possible', 'possible_with_conditions', 'not_possible', 'pending_further_review'] as const
const MAX_FILES = 10

export const dvrOrgs = (ctx: Ctx) => ({ create: orgsWith(ctx, 'dvr.create'), review: orgsWith(ctx, 'dvr.review'), manage: orgsWith(ctx, 'dvr.manage') })

export interface DvrRow { id: string; org_id: string; org_name: string; dvr_number: string; status: string; prospect_name: string; country: string; university: string | null; programme: string | null; intake: string | null; academic_year: string | null; counsellor: string | null; reviewer: string | null; overall_result: string | null; reverification_required: boolean; created_at: Date }

export async function listDvr(ctx: Ctx, orgIds: string[], f: { view?: string; status?: string; country?: string; q?: string; page?: unknown } = {}) {
  const page = pageOf(f.page)
  return run(ctx, async (tx) => {
    const view = f.view === 'mine' ? tx`and r.counsellor_id = ${ctx.userId}` : f.view === 'assigned' ? tx`and r.reviewer_id = ${ctx.userId}` : f.view === 'unassigned' ? tx`and r.reviewer_id is null and r.status = 'new_request'` : tx``
    const status = f.status && (DVR_STATUSES as readonly string[]).includes(f.status) ? tx`and r.status = ${f.status}` : tx``
    const country = f.country && UUID_RE.test(f.country) ? tx`and r.destination_country_id = ${f.country}` : tx``
    const term = f.q?.trim().replace(/[%_]/g, '')
    const q = term ? tx`and (r.dvr_number ilike ${'%' + term + '%'} or r.prospect_name ilike ${'%' + term + '%'})` : tx``
    const rows = await tx<(DvrRow & { total: string })[]>`
      select r.id, r.org_id, o.name as org_name, r.dvr_number, r.status, r.prospect_name, c.name as country, coalesce(un.name, r.university_text) as university, coalesce(co.name, r.programme_text) as programme, r.intake, r.academic_year,
             uc.full_name as counsellor, ur.full_name as reviewer, r.overall_result, r.reverification_required, r.created_at, count(*) over () as total
        from dvr_requests r join organizations o on o.id = r.org_id join countries c on c.id = r.destination_country_id
        left join universities un on un.id = r.university_id left join courses co on co.id = r.course_id
        left join user_profiles uc on uc.id = r.counsellor_id left join user_profiles ur on ur.id = r.reviewer_id
       where r.org_id = any(${tx.array(orgIds)}::uuid[]) ${view} ${status} ${country} ${q}
       order by r.created_at desc, r.id limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    return { rows, total: Number(rows[0]?.total ?? 0), page, pageSize: PAGE_SIZE }
  })
}

export async function getDvr(ctx: Ctx, id: string) {
  if (!UUID_RE.test(id)) return null
  return run(ctx, async (tx) => {
    const [r] = await tx<(DvrRow & { prospect_phone: string | null; prospect_email: string | null; destination_country_id: string; university_id: string | null; university_text: string | null; course_id: string | null; programme_text: string | null; remarks: string | null; special_instructions: string | null; counsellor_id: string; reviewer_id: string | null; overall_notes: string | null; assigned_at: Date | null; started_at: Date | null; submitted_at: Date | null; completed_at: Date | null; returned_at: Date | null; linked_student_id: string | null; linked_code: string | null; is_owner: boolean; is_reviewer: boolean; can_change_documents: boolean })[]>`
      select r.*, o.name as org_name, c.name as country, coalesce(un.name, r.university_text) as university, coalesce(co.name, r.programme_text) as programme, uc.full_name as counsellor, ur.full_name as reviewer, s.student_code as linked_code,
             app.dvr_is_owner(r.id) as is_owner, app.dvr_is_reviewer(r.id) as is_reviewer, app.dvr_can_change_documents(r.id) as can_change_documents
        from dvr_requests r join organizations o on o.id = r.org_id join countries c on c.id = r.destination_country_id
        left join universities un on un.id = r.university_id left join courses co on co.id = r.course_id
        left join user_profiles uc on uc.id = r.counsellor_id left join user_profiles ur on ur.id = r.reviewer_id left join students s on s.id = r.linked_student_id
       where r.id = ${id}`
    if (!r) return null
    const [documents, files, reviews, events, changes, reviewers] = await Promise.all([
      tx<{ id: string; category: string; label: string | null; result: string | null; result_notes: string | null; reviewed_at: Date | null; reviewer: string | null; created_at: Date }[]>`
        select d.id, d.category, d.label, d.result, d.result_notes, d.reviewed_at, u.full_name as reviewer, d.created_at from dvr_documents d left join user_profiles u on u.id = d.reviewed_by where d.request_id = ${id} and d.removed_at is null order by d.created_at, d.id`,
      tx<{ id: string; context_id: string; original_filename: string; scan_status: string; size_bytes: number; uploaded_at: Date; uploader: string | null }[]>`
        select f.id, f.context_id, f.original_filename, f.scan_status, f.size_bytes::int as size_bytes, f.uploaded_at, u.full_name as uploader from secure_files f join dvr_documents d on d.id = f.context_id left join user_profiles u on u.id = f.uploaded_by
         where f.context_type = 'dvr' and d.request_id = ${id} order by f.uploaded_at, f.id`,
      tx<{ id: string; document_id: string; file_id: string | null; result: string; notes: string | null; reviewed_at: Date; reviewer: string | null }[]>`
        select x.id, x.document_id, x.file_id, x.result, x.notes, x.reviewed_at, u.full_name as reviewer from dvr_document_reviews x left join user_profiles u on u.id = x.reviewed_by where x.request_id = ${id} order by x.reviewed_at desc, x.id`,
      tx<{ id: string; action: string; from_status: string | null; to_status: string | null; note: string | null; at: Date; actor: string | null }[]>`
        select e.id, e.action, e.from_status, e.to_status, e.note, e.created_at as at, u.full_name as actor from dvr_events e left join user_profiles u on u.id = e.actor_id where e.request_id = ${id} order by e.created_at desc, e.id`,
      tx<{ id: string; field: string; old_value: string | null; new_value: string | null; needs_reverification: boolean; changed_at: Date; changer: string | null }[]>`
        select c.id, c.field, c.old_value, c.new_value, c.needs_reverification, c.changed_at, u.full_name as changer from dvr_field_changes c left join user_profiles u on u.id = c.changed_by where c.request_id = ${id} order by c.changed_at desc, c.id`,
      tx<{ id: string; full_name: string }[]>`select id, full_name from app.dvr_reviewers(${r.org_id})`,
    ])
    return { request: r, documents, files, reviews, events, changes, reviewers }
  })
}

export async function dvrLinksForStudent(ctx: Ctx, studentId: string) {
  return run(ctx, (tx) => tx<{ id: string; dvr_number: string }[]>`select id, dvr_number from dvr_requests where linked_student_id = ${studentId} order by created_at`)
}

function fields(v: Record<string, unknown>) {
  const s = (k: string) => String(v[k] ?? '').trim()
  const id = (k: string) => { const x = s(k); return UUID_RE.test(x) ? x : '' }
  return { prospect_name: s('prospectName'), prospect_phone: s('prospectPhone'), prospect_email: s('prospectEmail'), destination_country_id: id('countryId'), university_id: id('universityId'), university_text: s('universityText'), course_id: id('courseId'), programme_text: s('programmeText'), intake: s('intake'), academic_year: s('academicYear'), remarks: s('remarks'), special_instructions: s('specialInstructions') }
}

export async function createDvr(ctx: Ctx, orgId: string, v: Record<string, unknown>) {
  need(orgId)
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.dvr_create(${orgId}, ${tx.json(fields(v))}) as id`)
  return r.id
}
export async function updateDvr(ctx: Ctx, id: string, v: Record<string, unknown>) {
  need(id)
  const [r] = await run(ctx, (tx) => tx<{ flagged: boolean }[]>`select app.dvr_update(${id}, ${tx.json(fields(v))}) as flagged`)
  return r.flagged
}

/** One document per file, as they may need different results. A document whose file is refused is taken out again, so nothing half-added stays. */
export async function addDvrDocuments(ctx: Ctx, id: string, category: string, label: string, files: File[]) {
  need(id)
  const real = files.filter((f) => f instanceof File && f.size > 0)
  if (!category.trim()) throw invalid('Choose the document category.')
  if (!real.length) throw invalid('Choose at least one PDF.')
  if (real.length > MAX_FILES) throw invalid(`Upload at most ${MAX_FILES} files at a time.`)
  let done = 0
  for (const file of real) {
    const [d] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.dvr_add_document(${id}, ${category}, ${label.trim() || null}) as id`)
    try {
      await uploadSecureFile(ctx, 'dvr', d.id, file)
      done++
    } catch (e) {
      await run(ctx, (tx) => tx`select app.dvr_remove_document(${d.id})`)
      if (done) throw invalid(`${done} file${done === 1 ? ' was' : 's were'} added, then ${file.name} was refused: ${(e as Error).message}`)
      throw e
    }
  }
  return done
}
export async function removeDvrDocument(ctx: Ctx, documentId: string) { need(documentId); await run(ctx, (tx) => tx`select app.dvr_remove_document(${documentId})`) }
export async function submitDvr(ctx: Ctx, id: string, note: string) { need(id); await run(ctx, (tx) => tx`select app.dvr_submit(${id}, ${note})`) }
export async function assignDvr(ctx: Ctx, id: string, reviewer: string, reason: string) { need(id); if (!UUID_RE.test(reviewer)) throw invalid('Choose a reviewer.'); await run(ctx, (tx) => tx`select app.dvr_assign(${id}, ${reviewer}, ${reason})`) }
export async function startDvr(ctx: Ctx, id: string) { need(id); await run(ctx, (tx) => tx`select app.dvr_start(${id})`) }
export async function reviewDvrDocument(ctx: Ctx, documentId: string, result: string, notes: string) { need(documentId); await run(ctx, (tx) => tx`select app.dvr_review_document(${documentId}, ${result}, ${notes})`) }
export async function requestDvrDocument(ctx: Ctx, id: string, category: string, notes: string) {
  need(id)
  if (category.trim().length < 2) throw invalid('Name the document that is needed.')
  await run(ctx, (tx) => tx`select app.dvr_request_document(${id}, ${category}, ${notes})`)
}
export async function sendBackDvr(ctx: Ctx, id: string, status: string, note: string) { need(id); await run(ctx, (tx) => tx`select app.dvr_send_back(${id}, ${status}, ${note})`) }
export async function completeDvr(ctx: Ctx, id: string, overall: string, notes: string) { need(id); await run(ctx, (tx) => tx`select app.dvr_complete(${id}, ${overall}, ${notes})`) }
export async function returnDvr(ctx: Ctx, id: string, note: string) { need(id); await run(ctx, (tx) => tx`select app.dvr_return(${id}, ${note})`) }
export async function closeDvr(ctx: Ctx, id: string, note: string) { need(id); await run(ctx, (tx) => tx`select app.dvr_close(${id}, false, ${note})`) }
export async function cancelDvr(ctx: Ctx, id: string, reason: string) { need(id); await run(ctx, (tx) => tx`select app.dvr_close(${id}, true, ${reason})`) }

/** Links an existing student the user can see, by Student ID. Never creates or changes a student. */
export async function linkDvrStudent(ctx: Ctx, id: string, code: string) {
  need(id)
  const term = code.trim()
  if (!term) throw invalid('Enter the Student ID.')
  await run(ctx, async (tx) => {
    const [s] = await tx<{ id: string }[]>`select id from students where student_code = ${term}`
    if (!s) throw invalid('No student with that ID was found.')
    await tx`select app.dvr_link_student(${id}, ${s.id})`
  })
}
