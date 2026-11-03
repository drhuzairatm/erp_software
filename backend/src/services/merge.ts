import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { invalid } from '../lib/errors'
import { getStorage, sniffMime } from '../lib/storage'
import { type Ctx, run } from './base'
import { mergeFilename } from '@/lib/merge-filename'
export { mergeFilename }

const UUID = /^[0-9a-f-]{36}$/i
export const MERGE_LIMITS = { documents: 40, bytes: 60 * 1024 * 1024, pages: 500 }
export const PURPOSES = { university_admission: 'University admission', visa_application: 'Visa application', embassy_submission: 'Embassy submission', general: 'General document package' } as const
export type Purpose = keyof typeof PURPOSES
const A4 = { w: 595.28, h: 841.89 }

export interface MergeCandidate {
  document_id: string; file_id: string; name: string; category: string; filename: string; mime: string; size: number; version: number
  uploaded_at: Date; uploader: string; status: string
}

/** Documents with a file that the user may download, plus what the filename needs. */
export async function mergeCandidates(ctx: Ctx, studentId: string) {
  if (!UUID.test(studentId)) return null
  return run(ctx, async (tx) => {
    const [p] = await tx<{ download: boolean; passport: boolean }[]>`
      select app.can_on_student(${studentId}, 'documents.download') as download, app.can_on_student(${studentId}, 'students.passport.view') as passport`
    if (!p?.download) return null
    const docs = await tx<MergeCandidate[]>`
      select d.id as document_id, f.id as file_id, t.name || case when d.label <> '' then ' – ' || d.label else '' end as name, t.category,
             f.original_filename as filename, f.mime_type as mime, f.size_bytes as size, f.version, f.uploaded_at,
             coalesce(u.full_name, case when f.uploaded_via = 'portal' then 'Student (portal)' else '—' end) as uploader, d.status
        from student_documents d join document_types t on t.id = d.document_type_id join document_files f on f.id = d.current_file_id
        left join user_profiles u on u.id = f.uploaded_by
       where d.student_id = ${studentId} order by d.is_required desc, t.sort_order, d.label`
    const [s] = await tx<{ full_name: string; student_code: string; passport_number: string | null; university_id: string | null; university: string | null; country_id: string | null }[]>`
      select s.full_name, s.student_code, ${p.passport ? tx`s.passport_number` : tx`null::text`} as passport_number, s.preferred_university_id as university_id,
             u.name as university, s.destination_country_id as country_id
        from v_students s left join universities u on u.id = s.preferred_university_id where s.id = ${studentId}`
    const universities = await tx<{ id: string; name: string }[]>`
      select id, name from universities where (is_active and (${s.country_id}::uuid is null or country_id = ${s.country_id})) or id = ${s.university_id} order by name`
    const history = await tx<{ id: string; filename: string; university: string | null; purpose: Purpose; pages: number | null; outcome: string; mode: string
      source_files: string[]; created_at: Date; by: string }[]>`
      select m.id, m.filename, un.name as university, m.purpose, m.pages, m.outcome, m.mode, m.source_files, m.created_at, u.full_name as by
        from document_merges m left join universities un on un.id = m.university_id join user_profiles u on u.id = m.created_by
       where m.student_id = ${studentId} order by m.created_at desc limit 20`
    return { docs, student: s, canSeePassport: p.passport, universities, history }
  })
}

export interface MergeCheck {
  ok: boolean; filename: string; pages: number; items: { file_id: string; name: string; pages: number | null; error: string | null; warning: string | null }[]
  unapproved: number; passportMissing: boolean; error?: string
}

/** Builds the combined PDF in the chosen order. If ANY document fails, no PDF is returned and the problems are listed. */
export async function buildMergedPdf(ctx: Ctx, studentId: string, fileIds: string[], opts: { universityId: string | null; purpose: string; allowUnapproved: boolean; mode: 'check' | 'download' | 'preview' }) {
  const c = await mergeCandidates(ctx, studentId)
  if (!c) throw invalid('You cannot download this student\'s documents.')
  if (!(opts.purpose in PURPOSES)) throw invalid('Choose the purpose.')
  const ids = fileIds.filter((f) => UUID.test(f))
  if (!ids.length) throw invalid('Select at least one document.')
  if (ids.length > MERGE_LIMITS.documents) throw invalid(`Select at most ${MERGE_LIMITS.documents} documents.`)
  if (new Set(ids).size !== ids.length) throw invalid('A document is selected twice.')
  const chosen = ids.map((id) => c.docs.find((d) => d.file_id === id))
  if (chosen.some((d) => !d)) throw invalid('A selected document is no longer current. Reload the page and select again.')
  const docs = chosen as MergeCandidate[]
  const total = docs.reduce((a, d) => a + d.size, 0)
  if (total > MERGE_LIMITS.bytes) throw invalid('The selected files are larger than 60 MB together. Select fewer documents.')
  const university = opts.universityId ? c.universities.find((u) => u.id === opts.universityId) ?? null : null
  if (opts.universityId && !university) throw invalid('Choose a university from the list.')
  const filename = mergeFilename(c.student.full_name, c.student.passport_number, university?.name ?? null, c.student.student_code)
  const unapproved = docs.filter((d) => d.status !== 'approved').length
  const result: MergeCheck = { ok: true, filename, pages: 0, unapproved, passportMissing: !c.student.passport_number,
    items: docs.map((d) => ({ file_id: d.file_id, name: d.name, pages: null, error: null, warning: d.status !== 'approved' ? `Not approved (${d.status.replace(/_/g, ' ')})` : null })) }
  if (unapproved && !opts.allowUnapproved && opts.mode !== 'check') throw invalid('Some selected documents are not approved. Tick the confirmation to include them.')

  const out = await PDFDocument.create()
  out.setTitle(filename.replace(/\.pdf$/, ''))
  out.setCreator('Admissions ERP'); out.setProducer('Admissions ERP')
  const storage = await getStorage()
  for (const [i, d] of docs.entries()) {
    const item = result.items[i]
    try {
      // authorised and audited per file, exactly like a normal download
      const [f] = await run(ctx, (tx) => tx<{ storage_key: string; mime_type: string }[]>`select * from app.authorize_file_download(${d.file_id})`)
      if (!f) throw new Error('You are not allowed to download this file.')
      const buf = await storage.get(f.storage_key)
      const kind = sniffMime(buf)
      if (kind === 'application/pdf') {
        let pages
        try {
          const src = await PDFDocument.load(buf, { updateMetadata: false })
          if (src.getPageCount() === 0) throw new Error('empty')
          pages = await out.copyPages(src, src.getPageIndices())
        } catch (e) {
          throw new Error(/encrypt/i.test(String(e)) ? 'The PDF is password-protected or encrypted.' : 'The PDF is damaged or cannot be read.')
        }
        pages.forEach((pg) => out.addPage(pg))
        item.pages = pages.length
      } else if (kind === 'image/jpeg' || kind === 'image/png' || kind === 'image/webp') {
        let img: Buffer; let w: number; let h: number
        try {
          const r = await sharp(buf, { limitInputPixels: 60_000_000, failOn: 'error' }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true })
          img = r.data; w = r.info.width; h = r.info.height
        } catch { throw new Error('The image is damaged or cannot be read.') }
        const embedded = await out.embedJpg(img)
        const landscape = w > h
        const page = out.addPage(landscape ? [A4.h, A4.w] : [A4.w, A4.h])
        const margin = 18
        const scale = Math.min((page.getWidth() - margin * 2) / w, (page.getHeight() - margin * 2) / h, 1.5)
        const dw = w * scale; const dh = h * scale
        page.drawImage(embedded, { x: (page.getWidth() - dw) / 2, y: (page.getHeight() - dh) / 2, width: dw, height: dh })
        item.pages = 1
      } else {
        throw new Error('Unsupported file type.')
      }
    } catch (e) {
      item.error = (e as Error).message
      result.ok = false
    }
  }
  result.pages = result.items.reduce((a, x) => a + (x.pages ?? 0), 0)
  if (result.pages > MERGE_LIMITS.pages) { result.ok = false; result.error = `The combined PDF would have ${result.pages} pages (maximum ${MERGE_LIMITS.pages}).` }
  if (!result.ok && !result.error) result.error = 'Some documents could not be added. Nothing was generated – correct the selection and try again.'
  if (opts.mode === 'check') return { check: result, pdf: null }
  await run(ctx, (tx) => tx`select app.record_document_merge(${studentId}, ${filename}, ${ids}::uuid[], ${university?.id ?? null}, ${opts.purpose}, ${result.pages},
    ${unapproved > 0}, ${result.ok ? 'success' : 'failure'}, ${result.ok ? null : result.items.filter((x) => x.error).map((x) => `${x.name}: ${x.error}`).join('; ') || result.error || null}, ${opts.mode})`)
  if (!result.ok) return { check: result, pdf: null }
  return { check: result, pdf: await out.save() }
}
