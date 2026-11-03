/** Merge & Download PDF: formats, order, filename rules, failures never silently skipped, originals untouched, permissions, history. */
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as documents from '@/services/documents'
import { buildMergedPdf, mergeCandidates, mergeFilename } from '@/services/merge'
import * as students from '@/services/students'
import { adminSql, ctxFor, orgId } from '../support/helpers'

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}
async function pdf(pages: number, width: number) {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) d.addPage([width, 800])
  return new File([new Uint8Array(await d.save())], `doc-${width}.pdf`, { type: 'application/pdf' })
}
const img = async (kind: 'jpeg' | 'png', w: number, h: number) => new File([new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#cfd8e3' } })[kind]().toBuffer())],
  `scan.${kind === 'jpeg' ? 'jpg' : 'png'}`, { type: `image/${kind}` })

/** Student with fictional passport + university and several uploaded documents. */
async function setup() {
  const mgr = await ctxFor('edx.manager@demo.test')
  const [uni] = await adminSql()`select u.id, u.name, u.country_id from universities u where u.is_active and u.name like 'Medical University – Varna%' limit 1`
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Mohammed Huzair', phone: `+91 90088 ${rand()}`,
    destinationCountryId: uni.country_id, preferredUniversityId: uni.id, passportNumber: `A${rand()}${rand().slice(0, 2)}`, passportExpiry: '2035-01-01' })
  if (!r.ok) throw new Error()
  const items = (await documents.getChecklist(mgr, r.id)).items
  const up = async (key: string, f: File) => { const d = items.find((i) => i.type_key === key)!; await documents.uploadDocument(mgr, d.id, f); return d.id }
  await up('passport', await pdf(2, 500))
  await up('tenth_certificate', await img('jpeg', 1200, 800)) // landscape scan
  await up('plus_two_certificate', await img('png', 700, 1000))
  await up('birth_certificate', await pdf(1, 612))
  const c = (await mergeCandidates(mgr, r.id))!
  const file = (name: string) => c.docs.find((d) => d.name.startsWith(name))!.file_id
  const [s] = await adminSql()`select passport_number from students where id = ${r.id}`
  return { mgr, id: r.id, uni, passport: s.passport_number as string, file, c }
}

describe('merge & download PDF', () => {
  it('merges PDFs and images in the chosen order; images become pages at their orientation', async () => {
    const s = await setup()
    const order = [s.file('Birth'), s.file('Passport'), s.file('10th'), s.file('Plus Two')]
    const r = await buildMergedPdf(s.mgr, s.id, order, { universityId: s.uni.id, purpose: 'university_admission', allowUnapproved: true, mode: 'download' })
    expect(r.check.ok).toBe(true)
    const out = await PDFDocument.load(r.pdf!)
    expect(out.getPageCount()).toBe(5)
    const sizes = out.getPages().map((p) => Math.round(p.getWidth()))
    expect(sizes.slice(0, 3)).toEqual([612, 500, 500]) // birth certificate first, then the 2-page passport
    expect(out.getPages()[3].getWidth()).toBeGreaterThan(out.getPages()[3].getHeight()) // landscape JPG → landscape page
    expect(out.getPages()[4].getHeight()).toBeGreaterThan(out.getPages()[4].getWidth()) // portrait PNG
    expect(r.check.filename).toBe(`Mohammed Huzair - ${s.passport} - ${s.uni.name}.pdf`)
  })

  it('filename fallbacks and sanitising', () => {
    expect(mergeFilename('Mohammed Huzair', 'A1234567', 'Tbilisi State University', 'X')).toBe('Mohammed Huzair - A1234567 - Tbilisi State University.pdf')
    expect(mergeFilename('Mohammed Huzair', 'A1234567', null, 'X')).toBe('Mohammed Huzair - A1234567.pdf')
    expect(mergeFilename('Mohammed Huzair', null, 'Tbilisi State University', 'X')).toBe('Mohammed Huzair - Tbilisi State University.pdf')
    expect(mergeFilename('Mohammed Huzair', null, null, 'X')).toBe('Mohammed Huzair.pdf')
    expect(mergeFilename(null, null, null, 'EDX-26-000001')).toBe('EDX-26-000001.pdf')
    expect(mergeFilename('  Abdul / Rahman: "Jr"  ', 'B98 76', 'Cairo<Univ>ersity?', 'X')).toBe('Abdul Rahman Jr - B9876 - Cairo Univ ersity.pdf')
    expect(mergeFilename('Name - With - Dashes', 'P1', 'U', 'X')).toBe('Name – With – Dashes - P1 - U.pdf')
  })

  it('a damaged file stops the merge with a clear message; nothing is generated; failure is recorded', async () => {
    const s = await setup()
    const items = (await documents.getChecklist(s.mgr, s.id)).items
    const visa = items.find((i) => i.type_key === 'medical_certificate' || i.type_key === 'bank_statement' || i.type_key === 'photograph')
      ?? items.find((i) => !i.current_file_id)!
    await documents.uploadDocument(s.mgr, visa.id, new File([Buffer.from('%PDF-1.4\n broken nonsense without structure')], 'broken.pdf', { type: 'application/pdf' }))
    const broken = (await mergeCandidates(s.mgr, s.id))!.docs.find((d) => d.document_id === visa.id)!.file_id
    const r = await buildMergedPdf(s.mgr, s.id, [s.file('Passport'), broken], { universityId: null, purpose: 'general', allowUnapproved: true, mode: 'download' })
    expect(r.pdf).toBeNull()
    expect(r.check.ok).toBe(false)
    expect(r.check.items.find((x) => x.file_id === broken)?.error).toMatch(/damaged|cannot be read/)
    const [h] = await adminSql()`select outcome, failure_note from document_merges where student_id = ${s.id} order by created_at desc limit 1`
    expect(h.outcome).toBe('failure')
  })

  it('unapproved documents need confirmation; originals and their statuses never change', async () => {
    const s = await setup()
    const before = await adminSql()`select f.id, f.sha256, d.status from document_files f join student_documents d on d.id = f.student_document_id where d.student_id = ${s.id} order by f.id`
    await expectServiceError(buildMergedPdf(s.mgr, s.id, [s.file('Passport')], { universityId: null, purpose: 'visa_application', allowUnapproved: false, mode: 'download' }), 'invalid')
    const ok = await buildMergedPdf(s.mgr, s.id, [s.file('Passport')], { universityId: null, purpose: 'visa_application', allowUnapproved: true, mode: 'preview' })
    expect(ok.check.unapproved).toBe(1)
    const after = await adminSql()`select f.id, f.sha256, d.status from document_files f join student_documents d on d.id = f.student_document_id where d.student_id = ${s.id} order by f.id`
    expect(after).toEqual(before)
    const [h] = await adminSql()`select outcome, mode, purpose, included_unapproved, cardinality(source_files) as n from document_merges where student_id = ${s.id} and outcome = 'success'`
    expect(h).toMatchObject({ mode: 'preview', purpose: 'visa_application', included_unapproved: true, n: 1 })
    expect((await adminSql()`select 1 from audit_logs where action = 'documents_merged' and student_id = ${s.id}`).length).toBeGreaterThan(0)
  })

  it('only staff who may download the documents can merge; other companies cannot; limits apply', async () => {
    const s = await setup()
    expect(await mergeCandidates(await ctxFor('edx.counsellor@demo.test'), s.id)).toBeNull() // no documents.download
    expect(await mergeCandidates(await ctxFor('grd.manager@demo.test'), s.id)).toBeNull()
    await expectServiceError(buildMergedPdf(await ctxFor('grd.manager@demo.test'), s.id, [s.file('Passport')], { universityId: null, purpose: 'general', allowUnapproved: true, mode: 'download' }))
    await expectServiceError(buildMergedPdf(s.mgr, s.id, [s.file('Passport'), s.file('Passport')], { universityId: null, purpose: 'general', allowUnapproved: true, mode: 'check' }), 'invalid')
    await expectServiceError(buildMergedPdf(s.mgr, s.id, [], { universityId: null, purpose: 'general', allowUnapproved: true, mode: 'check' }), 'invalid')
  })
})
