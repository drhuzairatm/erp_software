/**
 * Bulk student import from CSV.
 *
 * Two steps, both fully validated on the server:
 *   1. previewImport  – parse, map columns, validate every row, detect duplicates (no writes)
 *   2. commitImport   – repeat ALL checks on the same file, then insert every "ready" row in one
 *                       transaction (all or nothing) and write an audit entry.
 * Nothing from the preview is trusted at commit time.
 */
import { can } from '../auth/context'
import type { Tx } from '../db'
import { forbidden, invalid } from '../errors'
import { studentSchema, type StudentInput } from '../validation'
import { audit, type Ctx, run } from './base'
import { insertStudent } from './students'

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
export const MAX_IMPORT_ROWS = 1000

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180: quoted fields, escaped quotes, commas/newlines in quotes)
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  // Accept semicolon-separated files (common with some Excel locales) if the header uses them
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === sep) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += c
  }
  if (quoted) throw invalid('The file has an unclosed quotation mark. Please re-save it as CSV and try again.')
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

// ---------------------------------------------------------------------------
// Column recognition
// ---------------------------------------------------------------------------
export const IMPORT_FIELDS = {
  fullName: { label: 'Full name', aliases: ['full name', 'name', 'student name', 'student', 'candidate name', 'lead name'] },
  phone: { label: 'Phone', aliases: ['phone', 'mobile', 'phone number', 'mobile number', 'contact', 'contact number', 'whatsapp', 'whatsapp number'] },
  email: { label: 'Email', aliases: ['email', 'email address', 'e-mail', 'mail'] },
  previousEducationCountry: { label: 'Previous education country', aliases: ['previous education country', 'education country', 'studied in', 'educated in', 'previous country'] },
  schoolCountry: { label: 'School / institution country', aliases: ['school country', 'institution country'] },
  institutionName: { label: 'School / institution name', aliases: ['school', 'school name', 'institution', 'institution name', 'college name'] },
  passportNumber: { label: 'Passport number (needs passport permission)', aliases: ['passport', 'passport number', 'passport no'] },
  passportExpiry: { label: 'Passport expiry', aliases: ['passport expiry', 'passport expiry date', 'passport valid until'] },
  preferredLanguage: { label: 'Preferred language', aliases: ['preferred language', 'language'] },
  dateOfBirth: { label: 'Date of birth', aliases: ['date of birth', 'dob', 'birth date'] },
  country: { label: 'Destination country', aliases: ['destination country', 'country', 'destination', 'preferred country'] },
  course: { label: 'Course', aliases: ['course', 'program', 'programme', 'course interested'] },
  university: { label: 'Preferred university', aliases: ['preferred university', 'university', 'college'] },
  leadSource: { label: 'Lead source', aliases: ['lead source', 'source', 'enquiry source'] },
  highestQualification: { label: 'Highest qualification', aliases: ['highest qualification', 'qualification', 'education'] },
  qualificationBoard: { label: 'Board / university', aliases: ['qualification board', 'board', 'school board'] },
  qualificationYear: { label: 'Year of passing', aliases: ['qualification year', 'year of passing', 'passing year', 'year'] },
  qualificationScore: { label: 'Score / percentage', aliases: ['qualification score', 'score', 'percentage', 'marks', 'plus two percentage', '12th percentage'] },
  entranceExam: { label: 'Entrance / language exam', aliases: ['entrance exam', 'exam'] },
  entranceScore: { label: 'Exam score', aliases: ['entrance score', 'exam score', 'neet score', 'neet marks'] },
  registrationDate: { label: 'Registration date', aliases: ['registration date', 'registered on', 'enquiry date', 'lead date', 'created date'] },
  nextAction: { label: 'Next action', aliases: ['next action', 'next step', 'follow up action'] },
  nextActionDue: { label: 'Next action due', aliases: ['next action due', 'due date', 'follow up date', 'next follow up'] },
  counsellorEmail: { label: 'Counsellor (email or full name)', aliases: ['counsellor email', 'counselor email', 'counsellor', 'counselor', 'assigned to', 'assigned', 'owner', 'lead owner'] },
  purpose: { label: 'Purpose / enquiry (saved in the internal note)', aliases: ['purpose', 'enquiry', 'inquiry', 'enquiry for', 'requirement', 'interested in'] },
  notes: { label: 'Notes (saved as an internal note)', aliases: ['notes', 'note', 'remarks', 'comments'] },
} as const

export type ImportField = keyof typeof IMPORT_FIELDS
const norm = (h: string) => h.toLowerCase().replace(/[_\-./]+/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

export function mapHeaders(headers: string[]) {
  const used = new Set<ImportField>()
  const columns: (ImportField | null)[] = []
  for (const h of headers) {
    const n = norm(h)
    const field = (Object.keys(IMPORT_FIELDS) as ImportField[]).find(
      (f) => !used.has(f) && (IMPORT_FIELDS[f].aliases as readonly string[]).some((a) => norm(a) === n),
    ) ?? null
    if (field) used.add(field)
    columns.push(field)
  }
  return {
    columns,
    recognised: headers.map((h, i) => ({ header: h, field: columns[i] })).filter((x) => x.field).map((x) => ({ header: x.header, label: IMPORT_FIELDS[x.field!].label })),
    ignored: headers.filter((h, i) => !columns[i] && h.trim() !== ''),
    missingRequired: !used.has('fullName') ? ['Full name'] : !used.has('phone') && !used.has('email') ? ['Phone or Email'] : [],
  }
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------
/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (day first, as used in India). */
export function parseDate(s: string | undefined): { value?: string; error?: string } {
  const t = s?.trim()
  if (!t) return {}
  let y: number, m: number, d: number
  let match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if ((match = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else return { error: `"${t}" is not a date (use DD/MM/YYYY or YYYY-MM-DD)` }
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { error: `"${t}" is not a valid date` }
  return { value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

function cleanPhone(s: string | undefined): { value?: string; error?: string } {
  const t = s?.trim()
  if (!t) return {}
  if (/^\d(\.\d+)?e\+\d+$/i.test(t)) return { error: 'Phone looks like Excel scientific notation (e.g. 9.19E+11). Format the column as Text and export again.' }
  const cleaned = t.replace(/[^\d+ ()-]/g, ' ').replace(/\s+/g, ' ').trim()
  return { value: cleaned }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------
export type RowStatus = 'ready' | 'duplicate' | 'error'

export interface ImportRow {
  line: number
  status: RowStatus
  fullName: string
  phone: string
  email: string
  summary: string
  messages: string[]
}

export interface ImportAnalysis {
  orgId: string
  orgName: string
  total: number
  counts: Record<RowStatus, number>
  recognised: { header: string; label: string }[]
  ignored: string[]
  rows: ImportRow[]
}

interface Prepared { row: ImportRow; input?: StudentInput; note?: string }

async function analyse(tx: Tx, ctx: Ctx, orgId: string, csvText: string): Promise<{ analysis: ImportAnalysis; prepared: Prepared[] }> {
  if (!can(ctx, 'students.import', orgId) || !can(ctx, 'students.create', orgId)) {
    throw forbidden('You do not have permission to import students for this company.')
  }
  if (Buffer.byteLength(csvText, 'utf8') > MAX_IMPORT_BYTES) throw invalid('The file is larger than 2 MB. Split it into smaller files.')
  if (csvText.includes('�')) throw invalid('The file is not valid UTF-8 text. In Excel use "Save as → CSV UTF-8 (Comma delimited)".')
  const table = parseCsv(csvText)
  if (table.length < 2) throw invalid('The file has no data rows. The first row must contain column names.')
  const [headers, ...data] = table
  if (data.length > MAX_IMPORT_ROWS) throw invalid(`The file has ${data.length} rows; the limit is ${MAX_IMPORT_ROWS} per import.`)
  const map = mapHeaders(headers)
  if ((map.columns.includes('passportNumber') || map.columns.includes('passportExpiry')) && !can(ctx, 'students.passport.view', orgId)) {
    throw forbidden('The file contains passport columns, but you do not have permission to record passport details. Remove those columns or ask a manager.')
  }
  if (map.missingRequired.length) {
    throw invalid(`Required column missing: ${map.missingRequired.join(', ')}. Recognised columns: ${map.recognised.map((r) => r.header).join(', ') || 'none'}.`)
  }

  // Lookups (all filtered by RLS for the current user)
  const [org] = await tx<{ name: string }[]>`select name from organizations where id = ${orgId}`
  const countries = await tx<{ id: string; code: string; name: string }[]>`select id, code, name from countries where is_active`
  const courses = await tx<{ id: string; code: string; name: string }[]>`select id, code, name from courses where is_active`
  const universities = await tx<{ id: string; name: string; country_id: string }[]>`select id, name, country_id from universities where is_active`
  const sources = await tx<{ id: string; name: string }[]>`select id, name from lead_sources where org_id = ${orgId} and is_active`
  const staff = await tx<{ id: string; email: string; full_name: string }[]>`
    select u.id, lower(u.email) as email, u.full_name from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active
     where m.org_id = ${orgId} and m.is_active`
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const find = <T extends { name: string; code?: string }>(list: T[], v: string) =>
    list.find((x) => key(x.name) === key(v) || (x.code && key(x.code) === key(v)))
  const canAssign = can(ctx, 'students.assign', orgId)

  const seenPhones = new Map<string, number>()
  const seenEmails = new Map<string, number>()
  const prepared: Prepared[] = []

  for (let i = 0; i < data.length; i++) {
    const cells = data[i]
    const line = i + 2 // spreadsheet line number (header is line 1)
    const get = (f: ImportField) => {
      const idx = map.columns.indexOf(f)
      return idx >= 0 ? (cells[idx] ?? '').trim() || undefined : undefined
    }
    const messages: string[] = []
    const phone = cleanPhone(get('phone'))
    if (phone.error) messages.push(phone.error)
    const email = get('email')?.toLowerCase()
    const dob = parseDate(get('dateOfBirth'))
    const passportExpiry = parseDate(get('passportExpiry'))
    if (passportExpiry.error) messages.push(`Passport expiry: ${passportExpiry.error}`)
    const reg = parseDate(get('registrationDate'))
    const due = parseDate(get('nextActionDue'))
    for (const d of [dob, reg, due]) if (d.error) messages.push(d.error)

    const ref = (field: ImportField, label: string, lookup: (v: string) => { id: string } | undefined) => {
      const v = get(field)
      if (!v) return undefined
      const hit = lookup(v)
      if (!hit) messages.push(`${label} "${v}" is not in the system (add it under Company settings, or leave it blank)`)
      return hit?.id
    }
    const countryId = ref('country', 'Country', (v) => find(countries, v))
    const courseId = ref('course', 'Course', (v) => find(courses, v))
    const universityId = ref('university', 'University', (v) => {
      const matches = universities.filter((u) => key(u.name) === key(v))
      return countryId ? matches.find((u) => u.country_id === countryId) : matches.length === 1 ? matches[0] : undefined
    })
    const leadSourceId = ref('leadSource', 'Lead source', (v) => find(sources, v))
    const previousEducationCountryId = ref('previousEducationCountry', 'Previous education country', (v) => find(countries, v))
    const schoolCountryId = ref('schoolCountry', 'School country', (v) => find(countries, v))
    let counsellorId: string | undefined
    // Counsellor: accepts a work email or the staff member's full name (as CRMs usually export it)
    const cValue = get('counsellorEmail')
    if (cValue) {
      const v = cValue.toLowerCase()
      const nameKey = (n: string) => n.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
      const matches = v.includes('@') ? staff.filter((x) => x.email === v) : staff.filter((x) => nameKey(x.full_name) === nameKey(cValue))
      if (matches.length === 0) messages.push(`Counsellor "${cValue}" is not an active staff member of ${org?.name ?? 'this company'} (use their work email or exact full name)`)
      else if (matches.length > 1) messages.push(`More than one staff member is called "${cValue}" – use their work email instead`)
      else if (matches[0].id !== ctx.userId && !canAssign) messages.push('You are not allowed to assign other counsellors')
      else counsellorId = matches[0].id
    }

    const raw = {
      originatingOrgId: orgId,
      fullName: get('fullName'),
      phone: phone.value,
      email,
      preferredLanguage: get('preferredLanguage'),
      dateOfBirth: dob.value,
      destinationCountryId: countryId ?? (universityId ? universities.find((u) => u.id === universityId)?.country_id : undefined),
      courseId,
      preferredUniversityId: universityId,
      leadSourceId,
      highestQualification: get('highestQualification'),
      qualificationBoard: get('qualificationBoard'),
      qualificationYear: get('qualificationYear'),
      qualificationScore: get('qualificationScore'),
      entranceExam: get('entranceExam'),
      entranceScore: get('entranceScore'),
      registrationDate: reg.value,
      nextAction: get('nextAction'),
      nextActionDue: due.value,
      counsellorId,
      previousEducationCountryId,
      schoolCountryId,
      institutionName: get('institutionName'),
      passportNumber: get('passportNumber'),
      passportExpiry: passportExpiry.value,
    }
    const parsed = studentSchema.safeParse(raw)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const fieldName = String(issue.path[0] ?? '')
        const label = (IMPORT_FIELDS as Record<string, { label: string }>)[fieldName]?.label ?? fieldName
        messages.push(label ? `${label}: ${issue.message}` : issue.message)
      }
    }
    const purpose = get('purpose')
    const note = [purpose && `Purpose: ${purpose}`, get('notes')].filter(Boolean).join('\n') || undefined
    if (note && note.length > 5000) messages.push('Notes are longer than 5,000 characters')

    const row: ImportRow = {
      line, status: messages.length ? 'error' : 'ready', fullName: raw.fullName ?? '', phone: raw.phone ?? '', email: raw.email ?? '',
      summary: [get('country'), get('course'), purpose].filter(Boolean).join(' · '), messages,
    }

    if (row.status === 'ready' && parsed.success) {
      // duplicates inside the file
      const digits = (parsed.data.phone ?? '').replace(/\D/g, '').slice(-10)
      const dupLine = (digits.length >= 7 && seenPhones.get(digits)) || (parsed.data.email && seenEmails.get(parsed.data.email))
      if (dupLine) {
        row.status = 'duplicate'
        row.messages.push(`Same phone or email as line ${dupLine} of this file`)
      }
      if (digits.length >= 7 && !seenPhones.has(digits)) seenPhones.set(digits, line)
      if (parsed.data.email && !seenEmails.has(parsed.data.email)) seenEmails.set(parsed.data.email, line)
      // duplicates already in the system (other brand: company name only)
      const dups = await tx<{ student_code: string | null; full_name: string | null; org_name: string; matched_on: string; visible: boolean }[]>`
        select * from app.find_duplicate_candidates(${parsed.data.phone ?? null}, ${parsed.data.email ?? null}, null, ${parsed.data.passportNumber ?? null})`
      for (const d of dups) {
        row.status = 'duplicate'
        row.messages.push(d.visible
          ? `Possible duplicate of ${d.student_code} – ${d.full_name} (${d.org_name}), matched on ${d.matched_on}`
          : `Matches a record in ${d.org_name} on ${d.matched_on} (not visible to you)`)
      }
    }
    prepared.push({ row, input: parsed.success ? parsed.data : undefined, note })
  }

  const rows = prepared.map((p) => p.row)
  const counts = { ready: 0, duplicate: 0, error: 0 }
  for (const r of rows) counts[r.status]++
  return {
    analysis: { orgId, orgName: org?.name ?? '', total: rows.length, counts, recognised: map.recognised, ignored: map.ignored, rows },
    prepared,
  }
}

export async function previewImport(ctx: Ctx, orgId: string, csvText: string): Promise<ImportAnalysis> {
  return run(ctx, async (tx) => (await analyse(tx, ctx, orgId, csvText)).analysis)
}

export interface ImportResult {
  imported: { line: number; studentCode: string; id: string }[]
  skipped: { line: number; reason: string }[]
}

/** Re-validates everything, then imports all eligible rows in ONE transaction (all or nothing). */
export async function commitImport(ctx: Ctx, orgId: string, csvText: string, opts: { includeDuplicates: boolean; fileName: string }): Promise<ImportResult> {
  return run(ctx, async (tx) => {
    const { analysis, prepared } = await analyse(tx, ctx, orgId, csvText)
    const result: ImportResult = { imported: [], skipped: [] }
    for (const p of prepared) {
      const eligible = p.row.status === 'ready' || (p.row.status === 'duplicate' && opts.includeDuplicates)
      if (!eligible || !p.input) {
        result.skipped.push({ line: p.row.line, reason: p.row.status === 'error' ? 'error' : 'possible duplicate' })
        continue
      }
      const id = await insertStudent(tx, ctx, p.input,
        p.row.status === 'duplicate' ? 'Student registered by CSV import (possible duplicate acknowledged)' : 'Student registered by CSV import')
      if (p.note) {
        await tx`insert into student_notes (student_id, org_id, body, created_by) values (${id}, ${orgId}, ${p.note}, ${ctx.userId})`
        await tx`select app.add_event(${id}, ${orgId}, 'note', 'note', 'Internal note added (from CSV import)')`
      }
      const [{ student_code }] = await tx<{ student_code: string }[]>`select student_code from students where id = ${id}`
      result.imported.push({ line: p.row.line, studentCode: student_code, id })
    }
    if (!result.imported.length) throw invalid('No rows were eligible for import. Fix the errors in the file and try again.')
    await audit(tx, 'import', 'students', null, {
      orgId,
      metadata: { file: opts.fileName.slice(0, 200), rows: analysis.total, imported: result.imported.length, skipped: result.skipped.length, includeDuplicates: opts.includeDuplicates },
    })
    return result
  })
}

/** Template file with every recognised column and two clearly fictional rows. */
export function importTemplateCsv() {
  // Same first columns as a Leadist CRM export, then Country and Course, then optional details.
  const headers = ['Name', 'Phone', 'Email', 'Assigned To', 'Purpose', 'Country', 'Course', 'Previous education country', 'School name', 'Preferred university', 'Lead source',
    'Preferred language', 'Date of birth', 'Highest qualification', 'Board', 'Year of passing', 'Score', 'Entrance exam', 'Exam score',
    'Registration date', 'Next action', 'Next action due', 'Notes']
  const rows = [
    ['Example Student One', '+91 90000 00011', 'example.one@example.test', '', 'MBBS abroad', 'Russia', 'MBBS', 'India', 'Example Public School', '', 'Website',
      'English', '15/06/2007', 'Plus Two (Science)', 'CBSE', '2025', '88%', 'NEET-UG', '420', '01/10/2026', 'Call parents', '05/11/2026',
      'FICTIONAL EXAMPLE – delete this row'],
    ['Example Student Two', '+91 90000 00022', '', '', 'Nursing enquiry', 'Germany', 'Nursing', 'Qatar', 'Example International School', '', 'Walk-in',
      'Malayalam', '', 'B.Sc Nursing', 'State Board', '2024', '76%', 'German A2', 'Pass', '2026-10-15', 'Collect passport copy', '2026-11-10',
      'FICTIONAL EXAMPLE – delete this row'],
  ]
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
