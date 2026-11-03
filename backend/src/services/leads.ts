import { can, canAny, orgsWith } from '../lib/auth/context'
import { forbidden, invalid, notFound } from '../lib/errors'
import { normalizePhone } from '@/lib/phone'
import { type Ctx, PAGE_SIZE, pageOf, run } from './base'
import { createStudent } from './students'

const UUID = /^[0-9a-f-]{36}$/i
const opt = (v?: string | null) => (v && UUID.test(v) ? v : null)

export const LEAD_STATUSES = {
  new: { label: 'New', tone: 'blue' }, contacted: { label: 'Contacted', tone: 'purple' }, interested: { label: 'Interested', tone: 'amber' },
  application_started: { label: 'Application started', tone: 'green' }, admission_confirmed: { label: 'Admission confirmed', tone: 'green' },
  not_interested: { label: 'Not interested', tone: 'slate' }, closed: { label: 'Closed', tone: 'slate' }, invalid: { label: 'Invalid', tone: 'red' },
} as const
export type LeadStatus = keyof typeof LEAD_STATUSES
export const PROGRAMMES = {
  mbbs: 'MBBS', nursing: 'Nursing', medical_pg: 'Medical PG', bachelors: "Bachelor's", general_pg: 'General PG', other: 'Other', not_sure: 'Not sure yet',
} as const
export const SOURCES = { manual: 'Entered by staff', referral: 'Referral', leadist: 'Leadist import', import: 'Import', web: 'Website' } as const
const CLOSING = ['not_interested', 'closed', 'invalid']

export const canSeeLeads = (ctx: Ctx) => canAny(ctx, ['leads.read', 'leads.review'])
export const canReviewLeads = (ctx: Ctx) => can(ctx, 'leads.review')

export interface LeadRow {
  id: string; org_id: string | null; org_name: string | null; full_name: string; phone: string | null; email: string | null; programme: string | null
  destination: string | null; source: string; status: LeadStatus; assigned_to: string | null; assignee: string | null; next_followup_on: string | null
  duplicate_status: string; created_at: Date; referrer_code: string | null; converted_student_id: string | null; overdue: boolean; total: string
}

export interface LeadFilters { view?: string; status?: string; source?: string; mine?: string; q?: string; page?: string }

export async function listLeads(ctx: Ctx, orgIds: string[], f: LeadFilters) {
  if (!canSeeLeads(ctx)) throw forbidden()
  const page = pageOf(f.page)
  const readable = orgIds.filter((o) => can(ctx, 'leads.read', o))
  return run(ctx, async (tx) => {
    const scope = f.view === 'review' ? tx`l.org_id is null` : tx`l.org_id = any(${tx.array(readable)}::uuid[])`
    const conds = [scope]
    const open = tx`l.status not in ('application_started', 'admission_confirmed', 'not_interested', 'closed', 'invalid')`
    if (f.view === 'open' || !f.view) conds.push(open)
    if (f.view === 'followup') conds.push(open, tx`l.next_followup_on <= current_date`)
    if (f.view === 'duplicates') conds.push(tx`l.duplicate_status = 'possible'`)
    if (f.view === 'referrals') conds.push(tx`l.source = 'referral'`)
    if (f.view === 'converted') conds.push(tx`l.status in ('application_started', 'admission_confirmed')`)
    if (f.status && f.status in LEAD_STATUSES) conds.push(tx`l.status = ${f.status}`)
    if (f.source && f.source in SOURCES) conds.push(tx`l.source = ${f.source}`)
    if (f.mine === 'yes') conds.push(tx`l.assigned_to = ${ctx.userId}`)
    if (f.q?.trim()) {
      const like = `%${f.q.trim().slice(0, 60).replace(/[\\%_]/g, (m) => '\\' + m)}%`
      const digits = f.q.replace(/\D/g, '').slice(-10)
      conds.push(tx`(l.full_name ilike ${like} or l.email_normalized ilike ${like} ${digits.length >= 6 ? tx`or l.phone_normalized like ${'%' + digits}` : tx``})`)
    }
    const where = conds.reduce((a, c) => tx`${a} and ${c}`)
    const rows = await tx<LeadRow[]>`
      select l.id, l.org_id, o.name as org_name, l.full_name, l.phone, l.email, l.programme, c.name as destination, l.source, l.status,
             l.assigned_to, u.full_name as assignee, l.next_followup_on::text, l.duplicate_status, l.created_at, rc.code as referrer_code,
             l.converted_student_id, (l.next_followup_on < current_date and l.status in ('new', 'contacted', 'interested')) as overdue,
             count(*) over () as total
        from leads l left join organizations o on o.id = l.org_id left join countries c on c.id = l.destination_country_id
        left join user_profiles u on u.id = l.assigned_to left join referrals r on r.id = l.referral_id left join referral_codes rc on rc.id = r.referral_code_id
       where ${where}
       order by (l.duplicate_status = 'possible') desc, l.next_followup_on nulls last, l.created_at desc
       limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    const [k] = await tx<{ new: number; followup: number; overdue: number; converted_30: number; review: number; duplicates: number; referrals_30: number; open: number }[]>`
      select count(*) filter (where l.status = 'new' and l.org_id = any(${tx.array(readable)}::uuid[]))::int as new,
             count(*) filter (where l.org_id = any(${tx.array(readable)}::uuid[]) and l.status in ('new', 'contacted', 'interested') and l.next_followup_on <= current_date)::int as followup,
             count(*) filter (where l.org_id = any(${tx.array(readable)}::uuid[]) and l.status in ('new', 'contacted', 'interested') and l.next_followup_on < current_date)::int as overdue,
             count(*) filter (where l.org_id = any(${tx.array(readable)}::uuid[]) and l.status in ('new', 'contacted', 'interested'))::int as open,
             count(*) filter (where l.org_id = any(${tx.array(readable)}::uuid[]) and l.status in ('application_started', 'admission_confirmed') and l.updated_at > now() - interval '30 days')::int as converted_30,
             count(*) filter (where l.org_id is null and l.status not in ('closed', 'invalid'))::int as review,
             count(*) filter (where l.duplicate_status = 'possible' and l.status not in ('closed', 'invalid'))::int as duplicates,
             count(*) filter (where l.source = 'referral' and l.created_at > now() - interval '30 days')::int as referrals_30
        from leads l`
    const bySource = await tx<{ source: string; n: number }[]>`
      select source, count(*)::int as n from leads where org_id = any(${tx.array(readable)}::uuid[]) and created_at > now() - interval '90 days' group by source order by n desc`
    return { rows, total: Number(rows[0]?.total ?? 0), page, pageSize: PAGE_SIZE, kpis: k, bySource }
  })
}

function leadValues(v: Record<string, string | undefined>) {
  const name = v.fullName?.trim()
  if (!name || name.length < 2) throw invalid('Enter the name.', { fullName: ['Required.'] })
  let phone: string | null = null
  if (v.phone?.trim()) {
    const p = normalizePhone(v.phone, (v.phoneCountry || 'IN') as never)
    if (!p.ok) throw invalid(p.message, { phone: [p.message] })
    phone = p.e164
  }
  const email = v.email?.trim().toLowerCase() || null
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid('Enter a valid email address.', { email: ['Invalid.'] })
  if (!phone && !email) throw invalid('Enter a mobile number or an email address.', { phone: ['Phone or email required.'] })
  if (v.programme && !(v.programme in PROGRAMMES)) throw invalid('Choose the programme.')
  return {
    full_name: name, phone, whatsapp: v.whatsapp?.trim() || null, email, residence_country_id: opt(v.residenceCountryId), destination_country_id: opt(v.destinationCountryId),
    course_id: opt(v.courseId), programme: v.programme || null, qualification: v.qualification?.trim().slice(0, 200) || null,
    preferred_company: v.preferredCompany?.trim().slice(0, 120) || null, remarks: v.remarks?.trim().slice(0, 2000) || null, lead_source_id: opt(v.leadSourceId),
  }
}

export async function createLead(ctx: Ctx, v: Record<string, string | undefined>) {
  const orgId = v.orgId === 'central' ? null : opt(v.orgId)
  if (orgId ? !can(ctx, 'leads.manage', orgId) : !canReviewLeads(ctx)) throw forbidden('You cannot add leads for this company.')
  const vals = leadValues(v)
  if (v.consent !== 'yes') throw invalid('Record that the person agreed to be contacted.', { consent: ['Required.'] })
  return run(ctx, async (tx) => {
    const [r] = await tx<{ id: string }[]>`insert into leads ${tx({ ...vals, org_id: orgId, source: 'manual', consent: true, consent_at: new Date(),
      assigned_to: orgId && can(ctx, 'leads.manage', orgId) ? ctx.userId : null, next_followup_on: v.nextFollowupOn || null } as never)} returning id`
    if (v.note?.trim()) await tx`insert into lead_activities (lead_id, kind, body) values (${r.id}, 'note', ${v.note.trim().slice(0, 2000)})`
    return r.id
  })
}

export async function getLead(ctx: Ctx, id: string) {
  if (!UUID.test(id) || !canSeeLeads(ctx)) return null
  return run(ctx, async (tx) => {
    const [lead] = await tx<(LeadRow & { whatsapp: string | null; residence: string | null; residence_country_id: string | null; destination_country_id: string | null
      course_id: string | null; course: string | null; qualification: string | null; preferred_company: string | null; remarks: string | null; consent: boolean
      consent_at: Date | null; duplicate_note: string | null; closed_reason: string | null; creator: string | null; student_code: string | null
      lead_source: string | null; referrer_student_id: string | null; referrer_code_student: string | null })[]>`
      select l.*, l.next_followup_on::text, o.name as org_name, c.name as destination, rc2.name as residence, co.name as course, u.full_name as assignee,
             cu.full_name as creator, s.student_code, ls.name as lead_source, r.referrer_student_id, rs.student_code as referrer_code_student, rc.code as referrer_code,
             false as overdue, 0 as total
        from leads l left join organizations o on o.id = l.org_id left join countries c on c.id = l.destination_country_id
        left join countries rc2 on rc2.id = l.residence_country_id left join courses co on co.id = l.course_id
        left join user_profiles u on u.id = l.assigned_to left join user_profiles cu on cu.id = l.created_by
        left join v_students s on s.id = l.converted_student_id left join lead_sources ls on ls.id = l.lead_source_id
        left join referrals r on r.id = l.referral_id left join referral_codes rc on rc.id = r.referral_code_id left join v_students rs on rs.id = r.referrer_student_id
       where l.id = ${id}`
    if (!lead) return null
    const activities = await tx<{ id: string; kind: string; body: string; actor: string | null; created_at: Date }[]>`
      select a.id::text, a.kind, a.body, u.full_name as actor, a.created_at from lead_activities a left join user_profiles u on u.id = a.actor
       where a.lead_id = ${id} order by a.id desc`
    const orgs = lead.org_id ? [lead.org_id] : orgsWith(ctx, 'leads.manage')
    const staff = orgs.length ? await tx<{ id: string; full_name: string; org_id: string }[]>`
      select distinct u.id, u.full_name, m.org_id from organization_memberships m join user_profiles u on u.id = m.user_id join role_permissions rp on rp.role_id = m.role_id
       where m.org_id = any(${tx.array(orgs)}::uuid[]) and m.is_active and u.is_active and rp.permission_key = 'leads.manage' order by u.full_name` : []
    const manage = lead.org_id ? can(ctx, 'leads.manage', lead.org_id) : canReviewLeads(ctx)
    return { lead, activities, staff, manage, review: canReviewLeads(ctx), canConvert: !!lead.org_id && can(ctx, 'students.create', lead.org_id) && can(ctx, 'leads.manage', lead.org_id) }
  })
}

export async function updateLead(ctx: Ctx, id: string, v: Record<string, string | undefined>) {
  const vals = leadValues(v)
  return run(ctx, async (tx) => {
    const r = await tx`update leads set ${tx(vals as never)} where id = ${id}`
    if (!r.count) throw notFound()
  })
}

export async function updateLeadWork(ctx: Ctx, id: string, v: Record<string, string | undefined>) {
  const status = v.status as LeadStatus
  if (!(status in LEAD_STATUSES)) throw invalid('Choose a status.')
  if (CLOSING.includes(status) && !v.closedReason?.trim()) throw invalid('Give the reason.', { closedReason: ['Required.'] })
  if (v.nextFollowupOn && !/^\d{4}-\d{2}-\d{2}$/.test(v.nextFollowupOn)) throw invalid('Use a valid date.')
  return run(ctx, async (tx) => {
    const [cur] = await tx<{ status: string }[]>`select status from leads where id = ${id}`
    if (!cur) throw notFound()
    if (['application_started', 'admission_confirmed'].includes(status) && cur.status !== status) {
      throw invalid('This status is set by converting the lead to a student (and by the admission letter stage).')
    }
    const r = await tx`update leads set status = ${status}, assigned_to = ${opt(v.assignedTo)}, next_followup_on = ${v.nextFollowupOn || null},
                         closed_reason = ${CLOSING.includes(status) ? v.closedReason!.trim().slice(0, 500) : null} where id = ${id}`
    if (!r.count) throw forbidden()
    if (v.note?.trim()) await tx`insert into lead_activities (lead_id, kind, body) values (${id}, ${v.noteKind === 'call' ? 'call' : 'note'}, ${v.note.trim().slice(0, 2000)})`
  })
}

/** Central review queue → company (or back to the queue). */
export async function routeLead(ctx: Ctx, id: string, orgId: string | null) {
  if (!canReviewLeads(ctx)) throw forbidden()
  if (orgId && !can(ctx, 'leads.manage', orgId)) throw forbidden('You cannot route leads to this company.')
  return run(ctx, async (tx) => {
    const r = await tx`update leads set org_id = ${orgId}, assigned_to = null where id = ${id}`
    if (!r.count) throw notFound()
  })
}

export async function reviewDuplicate(ctx: Ctx, id: string, decision: 'duplicate' | 'not_duplicate') {
  return run(ctx, async (tx) => {
    const r = await tx`update leads set duplicate_status = ${decision},
                         status = case when ${decision} = 'duplicate' and status not in ('application_started', 'admission_confirmed') then 'invalid' else status end,
                         closed_reason = case when ${decision} = 'duplicate' and status not in ('application_started', 'admission_confirmed') then 'Duplicate of an existing lead or student' else closed_reason end
                       where id = ${id} and duplicate_status = 'possible'`
    if (!r.count) throw invalid('This lead is not waiting for a duplicate review.')
  })
}

/** Registers the lead as a student (normal registration rules, duplicate checks and permissions) and links it. */
export async function convertLead(ctx: Ctx, id: string) {
  const data = await getLead(ctx, id)
  if (!data) throw notFound()
  const l = data.lead
  if (!l.org_id) throw invalid('Route the lead to a company first.')
  if (l.converted_student_id) throw invalid('This lead is already registered as a student.')
  const r = await createStudent(ctx, {
    originatingOrgId: l.org_id, fullName: l.full_name, phone: l.phone ?? undefined, email: l.email ?? undefined,
    destinationCountryId: l.destination_country_id ?? undefined, courseId: l.course_id ?? undefined, residenceCountryId: l.residence_country_id ?? undefined,
  })
  if (!r.ok) return r
  await run(ctx, (tx) => tx`select app.link_lead_student(${id}, ${r.id})`)
  return r
}

// ---------------------------------------------------------------- Leadist / CSV import
const HEADERS: Record<string, string> = {
  name: 'full_name', 'full name': 'full_name', 'lead name': 'full_name', phone: 'phone', mobile: 'phone', 'mobile number': 'phone',
  whatsapp: 'whatsapp', email: 'email', 'email address': 'email', course: 'programme', programme: 'programme', program: 'programme',
  remarks: 'remarks', notes: 'remarks', id: 'external_ref', 'lead id': 'external_ref', qualification: 'qualification',
}
const PROGRAMME_WORDS: [RegExp, string][] = [[/mbbs/i, 'mbbs'], [/nurs/i, 'nursing'], [/(md|ms|medical).*pg|pg.*medical|neet.?pg/i, 'medical_pg'],
  [/bachelor|b\.?sc|bba|b\.?tech|degree|ug/i, 'bachelors'], [/master|mba|m\.?sc|pg/i, 'general_pg']]

function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch; continue }
    if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim()))
}

/** Imports leads exported from Leadist (or another CSV). Existing Leadist ids are skipped; nothing is merged. */
export async function importLeads(ctx: Ctx, orgIdRaw: string, source: 'leadist' | 'import', file: File) {
  const orgId = orgIdRaw === 'central' ? null : opt(orgIdRaw)
  if (orgId ? !can(ctx, 'leads.manage', orgId) : !canReviewLeads(ctx)) throw forbidden()
  if (file.size > 2 * 1024 * 1024) throw invalid('The file is larger than 2 MB.')
  const rows = parseCsv(await file.text())
  if (rows.length < 2) throw invalid('The file has no data rows.')
  if (rows.length > 1001) throw invalid('Import at most 1,000 rows at a time.')
  const header = rows[0].map((h) => HEADERS[h.trim().toLowerCase()] ?? null)
  if (!header.includes('full_name') || !(header.includes('phone') || header.includes('email'))) {
    throw invalid('The first row must contain column names, including Name and Phone or Email.')
  }
  const errors: string[] = []; let added = 0; let skipped = 0
  await run(ctx, async (tx) => {
    for (const [i, r] of rows.slice(1).entries()) {
      const rec: Record<string, string> = {}
      header.forEach((h, k) => { if (h && r[k]?.trim()) rec[h] = r[k].trim() })
      const programme = rec.programme ? (PROGRAMME_WORDS.find(([re]) => re.test(rec.programme))?.[1] ?? 'other') : null
      let vals: ReturnType<typeof leadValues>
      try {
        vals = leadValues({ fullName: rec.full_name, phone: rec.phone, email: rec.email, whatsapp: rec.whatsapp, qualification: rec.qualification,
          remarks: [rec.remarks, rec.programme && `Course in source: ${rec.programme}`].filter(Boolean).join(' · ') })
      } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); continue }
      if (rec.external_ref && (await tx`select 1 from leads where source = ${source} and external_ref = ${rec.external_ref.slice(0, 120)}`).length) { skipped++; continue }
      await tx`savepoint row_insert`
      try {
        await tx`insert into leads ${tx({ ...vals, programme, org_id: orgId, source, external_ref: rec.external_ref?.slice(0, 120) ?? null } as never)}`
        await tx`release savepoint row_insert`
        added++
      } catch (e) {
        await tx`rollback to savepoint row_insert`
        errors.push(`Row ${i + 2}: could not be saved (${(e as { message?: string }).message ?? 'error'})`)
      }
    }
  })
  return { added, skipped, errors: errors.slice(0, 50) }
}

// ---------------------------------------------------------------- referrals (staff view)
export async function studentReferrals(ctx: Ctx, studentId: string) {
  return run(ctx, (tx) => tx<{ id: string; lead_id: string; name: string; status: string; created_at: Date; channel: string }[]>`
    select r.id, r.lead_id, l.full_name as name, l.status, r.created_at, r.channel
      from referrals r join leads l on l.id = r.lead_id where r.referrer_student_id = ${studentId} order by r.created_at desc`)
}
