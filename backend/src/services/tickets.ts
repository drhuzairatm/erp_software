import 'server-only'
import { anonymous } from '../lib/db'
import { invalid } from '../lib/errors'
import { refuseIfInfected } from '../lib/security/file-scan'
import { scannerName } from '../lib/security/scanner'
import { getStorage, MAX_UPLOAD_BYTES, newSecureStorageKey, safeFilename, sha256, sniffMime } from '../lib/storage'
import { PAGE_SIZE, type Ctx, pageOf, run } from './base'
import { tokenHash } from './portal'
import { uploadSecureFile } from './secure-files'

/** Questions from students. Staff reads rely on row-level security; students only ever go through app.portal_* functions keyed by their session. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const TICKET_CATEGORIES = ['admission', 'documents', 'visa', 'payments', 'courier', 'portal_account', 'other'] as const
export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_for_student', 'resolved', 'closed'] as const
const MAX_FILES = 3

/** Checks every file before anything is saved, so a refused file leaves no half-sent message. */
function readable(files: File[]) {
  const real = files.filter((f) => f instanceof File && f.size > 0)
  if (real.length > MAX_FILES) throw invalid(`Attach up to ${MAX_FILES} files to a message.`)
  if (real.reduce((n, f) => n + f.size, 0) > MAX_UPLOAD_BYTES) throw invalid('The files are larger than 10 MB together.')
  return real
}
async function checked(files: File[]) {
  const out: { file: File; buf: Buffer; mime: string }[] = []
  for (const file of readable(files)) {
    const buf = Buffer.from(await file.arrayBuffer())
    const mime = sniffMime(buf)
    if (!mime) throw invalid('Only PDF, JPEG, PNG or WebP files are accepted.')
    out.push({ file, buf, mime })
  }
  return out
}

// ---- staff
export interface TicketRow { id: string; org_id: string; org_name: string; ticket_number: string; student_id: string; student_name: string; student_code: string; category: string; subject: string; status: string; assignee: string | null; last_message_at: Date; last_from: string; created_at: Date }

export async function listTickets(ctx: Ctx, orgIds: string[], f: { view?: string; status?: string; category?: string; q?: string; page?: unknown } = {}) {
  const page = pageOf(f.page)
  return run(ctx, async (tx) => {
    const view = f.view === 'mine' ? tx`and t.assigned_to = ${ctx.userId}` : f.view === 'unassigned' ? tx`and t.assigned_to is null and t.status <> 'closed'` : f.view === 'waiting' ? tx`and t.last_from = 'student' and t.status not in ('resolved', 'closed')` : tx``
    const status = f.status && (TICKET_STATUSES as readonly string[]).includes(f.status) ? tx`and t.status = ${f.status}` : tx``
    const category = f.category && (TICKET_CATEGORIES as readonly string[]).includes(f.category) ? tx`and t.category = ${f.category}` : tx``
    const term = f.q?.trim().replace(/[%_]/g, '')
    const q = term ? tx`and (t.ticket_number ilike ${'%' + term + '%'} or t.subject ilike ${'%' + term + '%'} or s.student_code ilike ${'%' + term + '%'} or s.full_name ilike ${'%' + term + '%'})` : tx``
    const rows = await tx<(TicketRow & { total: string })[]>`
      select t.id, t.org_id, o.name as org_name, t.ticket_number, t.student_id, s.full_name as student_name, s.student_code, t.category, t.subject, t.status, u.full_name as assignee, t.last_message_at, t.last_from, t.created_at, count(*) over () as total
        from student_tickets t join organizations o on o.id = t.org_id cross join lateral app.ticket_student(t.id) s left join user_profiles u on u.id = t.assigned_to
       where t.org_id = any(${tx.array(orgIds)}::uuid[]) ${view} ${status} ${category} ${q}
       order by t.last_message_at desc, t.id limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    return { rows, total: Number(rows[0]?.total ?? 0), page, pageSize: PAGE_SIZE }
  })
}

export async function getTicket(ctx: Ctx, id: string) {
  if (!UUID_RE.test(id)) return null
  return run(ctx, async (tx) => {
    const [t] = await tx<(TicketRow & { assigned_to: string | null; can_manage: boolean })[]>`
      select t.*, o.name as org_name, s.full_name as student_name, s.student_code, u.full_name as assignee, app.ticket_can_manage(t.id) as can_manage
        from student_tickets t join organizations o on o.id = t.org_id cross join lateral app.ticket_student(t.id) s left join user_profiles u on u.id = t.assigned_to where t.id = ${id}`
    if (!t) return null
    const [messages, files, events, staff] = await Promise.all([
      tx<{ id: string; author_type: string; author: string | null; body: string; created_at: Date }[]>`select m.id, m.author_type, u.full_name as author, m.body, m.created_at from student_ticket_messages m left join user_profiles u on u.id = m.author_id where m.ticket_id = ${id} order by m.created_at, m.id`,
      tx<{ id: string; context_id: string; original_filename: string; scan_status: string }[]>`select f.id, f.context_id, f.original_filename, f.scan_status from secure_files f join student_ticket_messages m on m.id = f.context_id where f.context_type = 'ticket' and m.ticket_id = ${id} order by f.uploaded_at, f.id`,
      tx<{ id: string; action: string; from_status: string | null; to_status: string | null; note: string | null; by_student: boolean; created_at: Date; actor: string | null }[]>`select e.id, e.action, e.from_status, e.to_status, e.note, e.by_student, e.created_at, u.full_name as actor from student_ticket_events e left join user_profiles u on u.id = e.actor_id where e.ticket_id = ${id} order by e.created_at desc, e.id`,
      tx<{ id: string; full_name: string }[]>`select id, full_name from app.ticket_staff(${id})`,
    ])
    return { ticket: t, messages, files, events, staff }
  })
}

export async function replyTicket(ctx: Ctx, id: string, body: string, next: string, files: File[]) {
  if (!UUID_RE.test(id)) throw invalid('Not found.')
  const ready = await checked(files)
  const [m] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.ticket_reply(${id}, ${body}, ${next}) as id`)
  for (const { file } of ready) {
    try { await uploadSecureFile(ctx, 'ticket', m.id, file) } catch (e) { throw invalid(`Your reply was sent, but ${safeFilename(file.name)} was not attached: ${(e as Error).message}`) }
  }
}
export async function setTicketStatus(ctx: Ctx, id: string, status: string, note: string) {
  if (!UUID_RE.test(id)) throw invalid('Not found.')
  await run(ctx, (tx) => tx`select app.ticket_set_status(${id}, ${status}, ${note})`)
}
export async function assignTicket(ctx: Ctx, id: string, user: string, reason: string) {
  if (!UUID_RE.test(id)) throw invalid('Not found.')
  if (!UUID_RE.test(user)) throw invalid('Choose a person.')
  await run(ctx, (tx) => tx`select app.ticket_assign(${id}, ${user}, ${reason})`)
}

// ---- student
export interface PortalTicketRow { id: string; ticket_number: string; category: string; subject: string; status: string; last_message_at: string; last_from: string; created_at: string }
export interface PortalTicket { id: string; ticket_number: string; category: string; subject: string; status: string; created_at: string; messages: { id: string; from: 'student' | 'staff'; body: string; at: string; files: { id: string; name: string; scan_status: string }[] }[]; history: { action: string; to: string | null; at: string }[] }

export async function portalTickets(th: string, f: { q?: string; status?: string; page?: unknown } = {}) {
  const page = pageOf(f.page)
  const [r] = await anonymous((tx) => tx<{ d: { total: number; rows: PortalTicketRow[] } }[]>`select app.portal_tickets(${th}, ${f.q ?? ''}, ${f.status ?? ''}, ${page}) as d`)
  return { rows: r.d.rows, total: Number(r.d.total), page, pageSize: 20 }
}
export async function portalTicket(th: string, id: string) {
  if (!UUID_RE.test(id)) return null
  const [r] = await anonymous((tx) => tx<{ d: PortalTicket | null }[]>`select app.portal_ticket(${th}, ${id}) as d`)
  return r?.d ?? null
}

async function attachForStudent(th: string, messageId: string, ready: Awaited<ReturnType<typeof checked>>, scans: Awaited<ReturnType<typeof refuseIfInfected>>[]) {
  const [t] = await anonymous((tx) => tx<{ org: string | null }[]>`select app.portal_ticket_upload_target(${th}, ${messageId}) as org`)
  if (!t?.org) throw invalid('This question cannot take files now.')
  const storage = await getStorage()
  for (const [i, { file, buf, mime }] of ready.entries()) {
    const key = newSecureStorageKey(t.org, 'ticket', messageId)
    await storage.put(key, buf, mime)
    try {
      await anonymous((tx) => tx`select app.portal_ticket_register_file(${th}, ${messageId}, ${key}, ${safeFilename(file.name)}, ${mime}, ${buf.length}, ${sha256(buf)})`)
    } catch (e) {
      await storage.remove(key).catch(() => {})
      throw e
    }
    const scan = scans[i]
    if (scan) await anonymous((tx) => tx`select app.record_secure_file_scan(${key}, ${scan.status}, ${scan.engine}, ${scan.detail ?? null})`)
  }
}

export async function portalCreateTicket(category: string, subject: string, body: string, files: File[]) {
  const th = await tokenHash()
  if (!th) throw invalid('Your session has ended. Please sign in again.')
  const ready = await checked(files)
  const scans = []
  for (const r of ready) scans.push(await refuseIfInfected(null, r.buf, 'portal ticket'))
  const [t] = await anonymous((tx) => tx<{ ticket_id: string; message_id: string }[]>`select * from app.portal_ticket_create(${th}, ${category}, ${subject}, ${body})`)
  await attachForStudent(th, t.message_id, ready, scans)
  return t.ticket_id
}
export async function portalReplyTicket(id: string, body: string, files: File[]) {
  const th = await tokenHash()
  if (!th) throw invalid('Your session has ended. Please sign in again.')
  if (!UUID_RE.test(id)) throw invalid('Not found.')
  const ready = await checked(files)
  const scans = []
  for (const r of ready) scans.push(await refuseIfInfected(null, r.buf, 'portal ticket'))
  const [m] = await anonymous((tx) => tx<{ id: string }[]>`select app.portal_ticket_reply(${th}, ${id}, ${body}) as id`)
  await attachForStudent(th, m.id, ready, scans)
}
/** Bytes of an attachment on the signed-in student's own question. Logged in the database. With a scanner configured, only files it passed. */
export async function portalTicketFile(fileId: string, ip: string) {
  const th = await tokenHash()
  if (!th || !UUID_RE.test(fileId)) return null
  const [f] = await anonymous((tx) => tx<{ storage_key: string; mime_type: string; original_filename: string; scan_status: string }[]>`select * from app.portal_ticket_file(${th}, ${fileId}, ${ip})`)
  if (!f || (scannerName() && f.scan_status !== 'clean')) return null
  return { data: await (await getStorage()).get(f.storage_key), mime: f.mime_type, filename: f.original_filename }
}
