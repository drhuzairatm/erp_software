import { invalid, notFound } from '../errors'
import { getStorage, MAX_UPLOAD_BYTES, newStorageKey, safeFilename, sha256, SIGNED_URL_TTL_SECONDS, sniffMime } from '../storage'
import { CUSTODY_LOCATIONS } from '../validation'
import { type Ctx, run } from './base'

export interface ChecklistItem {
  id: string; document_type_id: string; type_name: string; type_key: string; category: string; has_expiry: boolean; label: string
  is_required: boolean; status: string; effective_status: string; expiry_date: string | null; rejection_reason: string | null
  reviewed_at: Date | null; reviewer_name: string | null; original_location: string | null; location_note: string | null
  third_party_ref: string | null; notes: string | null; current_file_id: string | null; current_version: number | null
  issuing_country_id: string | null; issuing_country: string | null; requirement_source: string
  verifier_name: string | null; approver_name: string | null; approved_at: Date | null; current_mime: string | null
  attestation_state: string | null; attestation_done: number | null; attestation_total: number | null
  current_filename: string | null; uploaded_at: Date | null; uploader_name: string | null
}

export async function getChecklist(ctx: Ctx, studentId: string) {
  return run(ctx, async (tx) => {
    const items = await tx<ChecklistItem[]>`
      select d.id, d.document_type_id, t.name as type_name, t.key as type_key, t.category, t.has_expiry, d.label, d.is_required,
             d.status,
             case when d.status = 'approved' and d.expiry_date is not null and d.expiry_date < current_date then 'expired' else d.status end as effective_status,
             d.expiry_date, d.rejection_reason, d.reviewed_at, ru.full_name as reviewer_name, d.original_location, d.location_note,
             d.third_party_ref, d.notes, d.current_file_id, f.version as current_version, f.original_filename as current_filename,
             f.uploaded_at, coalesce(uu.full_name, case when f.id is not null then 'Student (portal)' end) as uploader_name, d.issuing_country_id, ic.name as issuing_country, d.requirement_source,
             vu.full_name as verifier_name, au.full_name as approver_name, d.approved_at, f.mime_type as current_mime,
             att.state as attestation_state, att.done as attestation_done, att.total as attestation_total
        from student_documents d
        cross join lateral app.attestation_state(d.id) att
        left join countries ic on ic.id = d.issuing_country_id
        left join user_profiles vu on vu.id = d.verified_by
        left join user_profiles au on au.id = d.approved_by
        join document_types t on t.id = d.document_type_id
        left join document_files f on f.id = d.current_file_id
        left join user_profiles ru on ru.id = d.reviewed_by
        left join user_profiles uu on uu.id = f.uploaded_by
       where d.student_id = ${studentId}
       order by d.is_required desc, t.sort_order, d.label`
    const ids = items.map((i) => i.id)
    const [files, reviews, custody] = ids.length
      ? await Promise.all([
          tx<{ id: string; student_document_id: string; version: number; original_filename: string; mime_type: string; size_bytes: number; uploaded_at: Date; uploader: string | null }[]>`
            select f.id, f.student_document_id, f.version, f.original_filename, f.mime_type, f.size_bytes, f.uploaded_at, coalesce(u.full_name, 'Student (portal)') as uploader
              from document_files f left join user_profiles u on u.id = f.uploaded_by
             where f.student_document_id = any(${tx.array(ids)}::uuid[]) order by f.version desc`,
          tx<{ id: string; student_document_id: string; from_status: string; to_status: string; reason: string | null; reviewed_at: Date; reviewer: string | null }[]>`
            select r.id, r.student_document_id, r.from_status, r.to_status, r.reason, r.reviewed_at, u.full_name as reviewer
              from document_reviews r left join user_profiles u on u.id = r.reviewed_by
             where r.student_document_id = any(${tx.array(ids)}::uuid[]) order by r.reviewed_at desc`,
          tx<{ id: string; student_document_id: string; location: string; note: string | null; third_party_ref: string | null; recorded_at: Date; recorder: string | null }[]>`
            select c.id, c.student_document_id, c.location, c.note, c.third_party_ref, c.recorded_at, u.full_name as recorder
              from document_custody_events c left join user_profiles u on u.id = c.recorded_by
             where c.student_document_id = any(${tx.array(ids)}::uuid[]) order by c.recorded_at desc`,
        ])
      : [[], [], []]
    const [perms] = await tx<{ upload: boolean; review: boolean; approve: boolean; download: boolean; custody: boolean; file_view: boolean }[]>`
      select app.can_on_student(${studentId}, 'documents.upload') as upload, app.can_on_student(${studentId}, 'documents.review') as review,
             app.can_on_student(${studentId}, 'documents.approve') as approve, app.can_on_student(${studentId}, 'documents.download') as download,
             app.can_on_student(${studentId}, 'documents.custody') as custody, app.can_on_student(${studentId}, 'documents.file.view') as file_view`
    return { items, files, reviews, custody, perms }
  })
}

export async function addChecklistItem(ctx: Ctx, studentId: string, documentTypeId: string, label: string, required: boolean) {
  return run(ctx, async (tx) => {
    const [t] = await tx<{ name: string }[]>`select name from document_types where id = ${documentTypeId} and is_active`
    if (!t) throw invalid('Choose a document type.')
    await tx`insert into student_documents (student_id, document_type_id, label, is_required)
             values (${studentId}, ${documentTypeId}, ${label.trim().slice(0, 120)}, ${required})`
    await tx`select app.add_event(${studentId}, null, 'document', 'added', ${'Checklist item added: ' + t.name + (label.trim() ? ' – ' + label.trim() : '')})`
  })
}

export async function uploadDocument(ctx: Ctx, documentId: string, file: File) {
  if (!(file instanceof File) || file.size === 0) throw invalid('Choose a file to upload.')
  if (file.size > MAX_UPLOAD_BYTES) throw invalid('The file is larger than 10 MB.')
  const buf = Buffer.from(await file.arrayBuffer())
  const mime = sniffMime(buf)
  if (!mime) throw invalid('Only PDF, JPEG, PNG or WebP files are accepted.')
  // 1) authorize and find the storage location
  const target = await run(ctx, async (tx) => {
    const [d] = await tx<{ student_id: string; org_id: string; ok: boolean }[]>`
      select d.student_id, s.originating_org_id as org_id, app.can_on_student(d.student_id, 'documents.upload') as ok
        from student_documents d join students s on s.id = d.student_id where d.id = ${documentId}`
    if (!d) throw notFound()
    if (!d.ok) throw invalid('You do not have permission to upload documents for this student.')
    return d
  })
  // 2) store bytes under a random key, 3) register in the DB (rolls back the object on failure)
  const storage = await getStorage()
  const key = newStorageKey(target.org_id, target.student_id)
  await storage.put(key, buf, mime)
  try {
    await run(ctx, (tx) => tx`select app.register_document_file(${documentId}, ${key}, ${safeFilename(file.name)}, ${mime}, ${buf.length}, ${sha256(buf)})`)
  } catch (e) {
    await storage.remove(key).catch(() => {})
    throw e
  }
}

export const DOCUMENT_ACTIONS = ['start_review', 'verify', 'submit', 'approve', 'request_changes', 'reject', 'expire'] as const
export type DocumentAction = (typeof DOCUMENT_ACTIONS)[number]

/** Move a document through the review workflow (rules enforced in app.document_action). */
export async function documentAction(ctx: Ctx, documentId: string, action: string, reason?: string) {
  if (!(DOCUMENT_ACTIONS as readonly string[]).includes(action)) throw invalid('Unknown action.')
  return run(ctx, (tx) => tx`select app.document_action(${documentId}, ${action}, ${reason ?? null})`)
}

/** Record one verification check for the CURRENT file version (append-only). */
export async function recordVerification(ctx: Ctx, documentId: string, requirementId: string, result: string, comment?: string, detected?: boolean | null) {
  if (!['present', 'absent', 'not_applicable'].includes(result)) throw invalid('Choose a result.')
  return run(ctx, (tx) => tx`select app.record_verification(${documentId}, ${requirementId}, ${result}, ${comment ?? null}, ${detected ?? null})`)
}

export interface ReviewRequirement {
  id: string; rule_id: string; rule_name: string; rule_version: number; kind: string; text: string; keywords: string[]
  is_mandatory: boolean; guidance: string | null; latest_result: string | null; latest_comment: string | null
  latest_by: string | null; latest_at: Date | null
}

/** Everything the review page needs for one checklist item. */
export async function getDocumentReview(ctx: Ctx, documentId: string, fileId?: string) {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return null
  return run(ctx, async (tx) => {
    const [doc] = await tx<(ChecklistItem & { student_id: string; student_code: string; student_name: string; verified_by: string | null; submitted_by: string | null; submitter_name: string | null; approved_file_id: string | null })[]>`
      select d.*, t.name as type_name, t.key as type_key, t.category, t.has_expiry, s.student_code, s.full_name as student_name,
             (select name from countries where id = s.destination_country_id) as destination,
             vu.full_name as verifier_name, su.full_name as submitter_name, au.full_name as approver_name, f.version as current_version
        from student_documents d join document_types t on t.id = d.document_type_id
        join students s on s.id = d.student_id
        left join document_files f on f.id = d.current_file_id
        left join user_profiles vu on vu.id = d.verified_by
        left join user_profiles su on su.id = d.submitted_by
        left join user_profiles au on au.id = d.approved_by
       where d.id = ${documentId}`
    if (!doc) return null
    const files = await tx<{ id: string; version: number; original_filename: string; mime_type: string; size_bytes: number; uploaded_at: Date; uploader: string | null }[]>`
      select f.id, f.version, f.original_filename, f.mime_type, f.size_bytes, f.uploaded_at, coalesce(u.full_name, 'Student (portal)') as uploader
        from document_files f left join user_profiles u on u.id = f.uploaded_by where f.student_document_id = ${documentId} order by f.version desc`
    const viewFile = files.find((f) => f.id === fileId) ?? files[0] ?? null
    const requirements = await tx<ReviewRequirement[]>`
      select q.id, q.rule_id, r.name as rule_name, r.version as rule_version, q.kind, q.text, q.keywords, q.is_mandatory, q.guidance,
             lv.result as latest_result, lv.comment as latest_comment, lu.full_name as latest_by, lv.verified_at as latest_at
        from verification_requirements q join verification_rules r on r.id = q.rule_id
        left join lateral (select v.* from document_verifications v
                            where v.student_document_id = ${documentId} and v.file_id = ${doc.current_file_id} and v.requirement_id = q.id
                            order by v.verified_at desc, v.id desc limit 1) lv on true
        left join user_profiles lu on lu.id = lv.verified_by
       where q.rule_id in (select app.applicable_rules(${documentId}))
       order by r.name, q.sort_order, q.created_at`
    const [verifications, reviews, annotations, perms] = await Promise.all([
      tx<{ id: string; file_version: number; rule_version: number; requirement_text: string; result: string; detected: boolean | null; comment: string | null; verified_at: Date; by: string | null }[]>`
        select v.id, f.version as file_version, v.rule_version, v.requirement_text, v.result, v.detected, v.comment, v.verified_at, u.full_name as by
          from document_verifications v join document_files f on f.id = v.file_id left join user_profiles u on u.id = v.verified_by
         where v.student_document_id = ${documentId} order by v.verified_at desc, v.id desc`,
      tx<{ id: string; from_status: string; to_status: string; reason: string | null; reviewed_at: Date; reviewer: string | null; file_version: number | null }[]>`
        select r.id, r.from_status, r.to_status, r.reason, r.reviewed_at, coalesce(u.full_name, 'Student (portal)') as reviewer, f.version as file_version
          from document_reviews r left join user_profiles u on u.id = r.reviewed_by left join document_files f on f.id = r.file_id
         where r.student_document_id = ${documentId} order by r.reviewed_at desc`,
      viewFile
        ? tx<{ id: string; page: number; rects: { x: number; y: number; w: number; h: number }[]; quote: string | null; body: string; created_at: Date; author: string | null }[]>`
            select a.id, a.page, a.rects, a.quote, a.body, a.created_at, u.full_name as author
              from document_annotations a left join user_profiles u on u.id = a.created_by where a.file_id = ${viewFile.id} order by a.page, a.created_at`
        : Promise.resolve([]),
      tx<{ review: boolean; approve: boolean; upload: boolean; file_view: boolean; download: boolean }[]>`
        select app.can_on_student(${doc.student_id}, 'documents.review') as review, app.can_on_student(${doc.student_id}, 'documents.approve') as approve,
               app.can_on_student(${doc.student_id}, 'documents.upload') as upload, app.can_on_student(${doc.student_id}, 'documents.file.view') as file_view,
               app.can_on_student(${doc.student_id}, 'documents.download') as download`,
    ])
    const unmet = requirements.filter((r) => r.is_mandatory && r.latest_result !== 'present').length
    return { doc, destination: (doc as unknown as { destination: string | null }).destination, files, viewFile, requirements, unmet, verifications, reviews, annotations, perms: perms[0], me: ctx.userId }
  })
}

export async function addAnnotation(ctx: Ctx, fileId: string, page: number, rects: unknown, quote: string | undefined, body: string) {
  if (!Number.isInteger(page) || page < 1 || page > 5000) throw invalid('Invalid page.')
  if (!body?.trim()) throw invalid('Write a comment.')
  const clean = Array.isArray(rects)
    ? rects.slice(0, 50).map((r) => ({ x: num(r?.x), y: num(r?.y), w: num(r?.w), h: num(r?.h) }))
    : []
  return run(ctx, (tx) => tx`insert into document_annotations (file_id, page, rects, quote, body, created_by)
                              values (${fileId}, ${page}, ${tx.json(clean)}, ${quote?.slice(0, 2000) ?? null}, ${body.trim().slice(0, 4000)}, ${ctx.userId})`)
}
const num = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0))

/** File bytes for the in-app viewer (view permission; audited by the database). */
export async function fileContent(ctx: Ctx, fileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null
  const [f] = await run(ctx, (tx) => tx<{ storage_key: string; mime_type: string; original_filename: string }[]>`select * from app.authorize_file_access(${fileId})`)
  if (!f) return null
  return { data: await (await getStorage()).get(f.storage_key), mime: f.mime_type, filename: f.original_filename }
}

export async function recordCustody(ctx: Ctx, documentId: string, location: string, note?: string, ref?: string) {
  if (!(CUSTODY_LOCATIONS as readonly string[]).includes(location)) throw invalid('Choose a location.')
  return run(ctx, (tx) => tx`select app.record_document_custody(${documentId}, ${location}, ${note ?? null}, ${ref ?? null})`)
}

export async function updateDocumentDetails(ctx: Ctx, documentId: string, expiryDate: string | undefined, notes: string | undefined, issuingCountryId?: string) {
  if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) throw invalid('Use a valid expiry date.')
  if (issuingCountryId && !/^[0-9a-f-]{36}$/i.test(issuingCountryId)) throw invalid('Choose a country.')
  return run(ctx, async (tx) => {
    const r = await tx`update student_documents set expiry_date = ${expiryDate ?? null}, notes = ${notes?.slice(0, 2000) ?? null},
                         issuing_country_id = ${issuingCountryId ?? null} where id = ${documentId}`
    if (r.count === 0) throw notFound()
  })
}

/**
 * Download the original: authorize (documents.download) and issue a short-lived signed URL.
 * Returns null (→ 404) when not allowed. Both outcomes are audited by the database.
 */
export async function openFile(ctx: Ctx, fileId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null
  const [f] = await run(ctx, (tx) => tx<{ storage_key: string; mime_type: string; original_filename: string }[]>`
    select * from app.authorize_file_download(${fileId})`)
  if (!f) return null
  const storage = await getStorage()
  return storage.signedUrl(f.storage_key, { filename: f.original_filename, contentType: f.mime_type, expiresInSeconds: SIGNED_URL_TTL_SECONDS })
}
