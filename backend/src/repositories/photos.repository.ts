import type { Tx } from '../lib/db'

/**
 * Student and staff photo reads (Repository Pattern, Stage 2). Queries moved verbatim from services/photos.ts and
 * services/staff-photos.ts; the services keep the rules (id format, variants, file naming) and the transactions.
 * Authorization (and, for downloads, the audit row) happens inside the database functions, as before.
 */

/** Stored photo file of a student the user may see (thumb or portrait). No row = not allowed or no photo. */
export function studentPhotoFile(tx: Tx, studentId: string, variant: 'thumb' | 'portrait') {
  return tx<{ storage_key: string; mime_type: string; version: number }[]>`select * from app.student_photo_file(${studentId}, ${variant})`
}

/** The passport-photo original for download (audited by the database). No row = not allowed or no photo. */
export function studentPhotoDownloadFile(tx: Tx, studentId: string) {
  return tx<{ storage_key: string; mime_type: string }[]>`select * from app.student_photo_file(${studentId}, 'download')`
}

/** Name and student code for the download file name. */
export function studentNameAndCode(tx: Tx, studentId: string) {
  return tx<{ full_name: string; student_code: string }[]>`select full_name, student_code from v_students where id = ${studentId}`
}

/** The current photo's details (row-level security limits it to students the user can see). */
export function currentStudentPhoto(tx: Tx, studentId: string) {
  return tx<{ version: number; uploaded_at: Date; width: number; height: number }[]>`
    select version, uploaded_at, width, height from student_photos where student_id = ${studentId} and is_current`
}

/** Stored staff photo file (thumb or display) for a colleague who shares a company. No row = not allowed or no photo. */
export function staffPhotoFile(tx: Tx, userId: string, variant: 'thumb' | 'display') {
  return tx<{ storage_key: string; version: number }[]>`select * from app.staff_photo_file(${userId}, ${variant})`
}

/** Current photo versions of these people (row-level security applies). */
export function currentStaffPhotoVersions(tx: Tx, ids: string[]) {
  return tx<{ user_id: string; version: number }[]>`select user_id, version from staff_photos where is_current and user_id = any(${ids}::uuid[])`
}
