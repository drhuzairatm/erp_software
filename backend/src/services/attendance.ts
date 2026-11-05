import { createHash, randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import { forbidden, invalid } from '../lib/errors'
import { orgsWith } from '../lib/auth/context'
import { uploadSecureFile } from './secure-files'
import { PAGE_SIZE, type Ctx, pageOf, run } from './base'

/**
 * Attendance. The database decides what each signal means; this service only passes on what the device reported and what the server saw.
 * A failed signal never refuses attendance: it sends the record to manual review.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const FLAG_LABEL: Record<string, string> = {
  no_gps: 'Location not shared', outside_geofence: 'Outside the office area', low_gps_accuracy: 'Location was imprecise', no_office_configured: 'No office location configured',
  ip_not_allowed: 'Not on an office network', qr_missing: 'Office QR not scanned', qr_invalid: 'QR not valid', qr_expired: 'QR expired', qr_replayed: 'QR already used',
  photo_missing: 'No camera photo', photo_failed: 'Photo could not be saved',
}
export type AttendanceAction = 'check_in' | 'check_out' | 'break_start' | 'break_end'

const num = (v: unknown, min: number, max: number) => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}
export const hashQr = (token: string) => createHash('sha256').update(token).digest('hex')

export async function markAttendance(ctx: Ctx, v: { orgId?: string; action?: string; method?: string; lat?: unknown; lng?: unknown; accuracy?: unknown; qr?: string; device?: string; photo?: File | null }) {
  if (!UUID_RE.test(v.orgId ?? '')) throw invalid('Choose the company.')
  const action = v.action as AttendanceAction
  if (!['check_in', 'check_out', 'break_start', 'break_end'].includes(action)) throw invalid('Unknown action.')
  const photo = v.photo instanceof File && v.photo.size > 0 ? v.photo : null
  const qr = v.qr && /^[A-Za-z0-9_-]{20,100}$/.test(v.qr) ? hashQr(v.qr) : (v.qr ? hashQr('invalid') : null)
  const [r] = await run(ctx, (tx) => tx<{ record_id: string; event_id: string; status: string; flags: string[]; needs_review: boolean }[]>`
    select * from app.attendance_mark(${v.orgId!}, ${action}, ${v.method === 'kiosk' ? 'kiosk' : 'mobile'}, ${num(v.lat, -90, 90)}, ${num(v.lng, -180, 180)}, ${num(v.accuracy, 0, 1000000)},
      ${ctx.ip ?? null}, ${v.device?.slice(0, 300) ?? null}, ${qr}, ${!!photo})`)
  if (photo) {
    try {
      const fileId = await uploadSecureFile(ctx, 'attendance', r.record_id, photo)
      await run(ctx, (tx) => tx`select app.attendance_attach_photo(${r.event_id}, ${fileId})`)
    } catch {
      await run(ctx, (tx) => tx`select app.attendance_flag_event(${r.event_id}, 'photo_failed')`)
      return { ...r, flags: [...r.flags, 'photo_failed'], needs_review: true }
    }
  }
  return r
}

export interface AttendanceRecord { id: string; org_id: string; user_id: string; work_date: string; status: string; check_in_at: Date | null; check_out_at: Date | null; late_minutes: number; early_minutes: number; break_minutes: number; on_break_since: Date | null; review_status: string; review_note: string | null; office_name: string | null }

export async function myAttendance(ctx: Ctx, f: { page?: unknown } = {}) {
  const page = pageOf(f.page)
  return run(ctx, async (tx) => {
    const today = await tx<(AttendanceRecord & { today: string })[]>`
      select r.*, to_char(r.work_date, 'YYYY-MM-DD') as work_date, o.name as office_name from attendance_records r left join attendance_offices o on o.id = r.office_id
       where r.user_id = ${ctx.userId} and r.work_date = (now() at time zone coalesce((select p.timezone from attendance_policies p where p.org_id = r.org_id), 'Asia/Kolkata'))::date`
    const history = await tx<AttendanceRecord[]>`
      select r.*, to_char(r.work_date, 'YYYY-MM-DD') as work_date, o.name as office_name from attendance_records r left join attendance_offices o on o.id = r.office_id
       where r.user_id = ${ctx.userId} order by r.work_date desc, r.id limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from attendance_records where user_id = ${ctx.userId}`
    const corrections = await tx<{ id: string; work_date: string; status: string; reason: string; decision_note: string | null; created_at: Date }[]>`
      select id, to_char(work_date, 'YYYY-MM-DD') as work_date, status, reason, decision_note, created_at from attendance_corrections where user_id = ${ctx.userId} order by created_at desc limit 10`
    const leaves = await tx<{ id: string; kind: string; leave_type: string | null; from_date: string; to_date: string; status: string; reason: string; decision_note: string | null }[]>`
      select id, kind, leave_type, to_char(from_date, 'YYYY-MM-DD') as from_date, to_char(to_date, 'YYYY-MM-DD') as to_date, status, reason, decision_note from attendance_leaves where user_id = ${ctx.userId} order by from_date desc limit 10`
    const policies = await tx<{ org_id: string; leave_types: string[]; work_start: string; work_end: string; grace_minutes: number; timezone: string }[]>`
      select org_id, leave_types, to_char(work_start, 'HH24:MI') as work_start, to_char(work_end, 'HH24:MI') as work_end, grace_minutes, timezone from attendance_policies`
    return { today, history, total: n, page, pageSize: PAGE_SIZE, corrections, leaves, policies }
  })
}

const reviewOrgs = (ctx: Ctx) => orgsWith(ctx, 'attendance.review')

export async function attendanceToday(ctx: Ctx, orgIds: string[]) {
  const allowed = orgIds.filter((o) => orgsWith(ctx, 'attendance.view').includes(o) || reviewOrgs(ctx).includes(o))
  if (!allowed.length) throw forbidden()
  return run(ctx, (tx) => tx<{ user_id: string; full_name: string; job_title: string | null; org_id: string; org_name: string; department: string | null; photo_version: number | null; status: string | null; check_in_at: Date | null; check_out_at: Date | null; late_minutes: number | null; review_status: string | null }[]>`
    select u.id as user_id, u.full_name, u.job_title, m.org_id, o.name as org_name, d.name as department,
           (select p.version from staff_photos p where p.user_id = u.id and p.is_current) as photo_version,
           r.status, r.check_in_at, r.check_out_at, r.late_minutes, r.review_status
      from organization_memberships m join user_profiles u on u.id = m.user_id and u.account_status = 'active' join organizations o on o.id = m.org_id
      left join departments d on d.id = m.department_id
      left join attendance_records r on r.user_id = u.id and r.org_id = m.org_id
        and r.work_date = (now() at time zone coalesce((select pol.timezone from attendance_policies pol where pol.org_id = m.org_id), 'Asia/Kolkata'))::date
     where m.is_active and m.org_id = any(${tx.array(allowed)}::uuid[]) order by o.name, u.full_name`)
}

export async function attendanceWorkQueue(ctx: Ctx, orgIds: string[]) {
  const allowed = orgIds.filter((o) => reviewOrgs(ctx).includes(o))
  if (!allowed.length) return { reviews: [], corrections: [], leaves: [], suspicious: [] }
  return run(ctx, async (tx) => {
    const reviews = await tx<{ id: string; user_id: string; full_name: string; org_name: string; work_date: string; status: string; check_in_at: Date | null; check_out_at: Date | null; flags: string[] }[]>`
      select r.id, r.user_id, u.full_name, o.name as org_name, to_char(r.work_date, 'YYYY-MM-DD') as work_date, r.status, r.check_in_at, r.check_out_at,
             coalesce((select array_agg(distinct f) from attendance_events e cross join lateral unnest(e.flags) f where e.record_id = r.id), '{}') as flags
        from attendance_records r join user_profiles u on u.id = r.user_id join organizations o on o.id = r.org_id
       where r.review_status = 'pending' and r.org_id = any(${tx.array(allowed)}::uuid[]) order by r.work_date desc, u.full_name limit 100`
    const corrections = await tx<{ id: string; user_id: string; full_name: string; org_name: string; work_date: string; check_in_at: Date | null; check_out_at: Date | null; reason: string }[]>`
      select c.id, c.user_id, u.full_name, o.name as org_name, to_char(c.work_date, 'YYYY-MM-DD') as work_date, c.check_in_at, c.check_out_at, c.reason
        from attendance_corrections c join user_profiles u on u.id = c.user_id join organizations o on o.id = c.org_id
       where c.status = 'pending' and c.org_id = any(${tx.array(allowed)}::uuid[]) order by c.created_at limit 100`
    const leaves = await tx<{ id: string; user_id: string; full_name: string; org_name: string; kind: string; leave_type: string | null; from_date: string; to_date: string; reason: string }[]>`
      select l.id, l.user_id, u.full_name, o.name as org_name, l.kind, l.leave_type, to_char(l.from_date, 'YYYY-MM-DD') as from_date, to_char(l.to_date, 'YYYY-MM-DD') as to_date, l.reason
        from attendance_leaves l join user_profiles u on u.id = l.user_id join organizations o on o.id = l.org_id
       where l.status = 'pending' and l.org_id = any(${tx.array(allowed)}::uuid[]) order by l.from_date limit 100`
    const suspicious = await tx<{ id: string; full_name: string; org_name: string; event_type: string; occurred_at: Date; flags: string[]; client_ip: string | null; device_info: string | null; distance_m: number | null }[]>`
      select e.id, u.full_name, o.name as org_name, e.event_type, e.occurred_at, e.flags, e.client_ip, e.device_info, e.distance_m
        from attendance_events e join user_profiles u on u.id = e.user_id join organizations o on o.id = e.org_id
       where e.flags <> '{}' and e.org_id = any(${tx.array(allowed)}::uuid[]) order by e.occurred_at desc limit 50`
    return { reviews, corrections, leaves, suspicious }
  })
}

export async function recordEvents(ctx: Ctx, recordId: string) {
  if (!UUID_RE.test(recordId)) return []
  return run(ctx, (tx) => tx<{ id: string; event_type: string; occurred_at: Date; method: string; distance_m: number | null; accuracy_m: number | null; client_ip: string | null; device_info: string | null; qr_verified: boolean; flags: string[]; photo_file_id: string | null }[]>`
    select id, event_type, occurred_at, method, distance_m, accuracy_m, client_ip, device_info, qr_verified, flags, photo_file_id from attendance_events where record_id = ${recordId} order by occurred_at`)
}

export const decideReview = (ctx: Ctx, id: string, decision: string, note?: string) => run(ctx, (tx) => tx`select app.attendance_decide_review(${id}, ${decision}, ${note ?? null})`).then(() => undefined)
export const decideCorrection = (ctx: Ctx, id: string, decision: string, note?: string) => run(ctx, (tx) => tx`select app.attendance_decide_correction(${id}, ${decision}, ${note ?? null})`).then(() => undefined)
export const decideLeave = (ctx: Ctx, id: string, decision: string, note?: string) => run(ctx, (tx) => tx`select app.attendance_decide_leave(${id}, ${decision}, ${note ?? null})`).then(() => undefined)

export async function setAttendanceStatus(ctx: Ctx, v: { orgId?: string; userId?: string; date?: string; status?: string; note?: string }) {
  if (!UUID_RE.test(v.orgId ?? '') || !UUID_RE.test(v.userId ?? '') || !DATE_RE.test(v.date ?? '')) throw invalid('Choose the person and date.')
  await run(ctx, (tx) => tx`select app.attendance_set_status(${v.orgId!}, ${v.userId!}, ${v.date!}, ${v.status ?? ''}, ${v.note ?? ''})`)
}

export async function requestCorrection(ctx: Ctx, v: { orgId?: string; date?: string; checkIn?: string; checkOut?: string; reason?: string }) {
  const errs: Record<string, string[]> = {}
  if (!UUID_RE.test(v.orgId ?? '')) errs.orgId = ['Choose the company.']
  if (!DATE_RE.test(v.date ?? '')) errs.date = ['Choose the date.']
  if (!v.checkIn && !v.checkOut) errs.checkIn = ['Enter the correct check-in or check-out time.']
  if ((v.reason?.trim().length ?? 0) < 5) errs.reason = ['Give a reason (at least 5 characters).']
  if (Object.keys(errs).length) throw invalid('Please correct the highlighted fields.', errs)
  const time = (t?: string) => (t && /^\d{2}:\d{2}$/.test(t) ? t : null)
  const [r] = await run(ctx, (tx) => {
    const zone = tx`coalesce((select p.timezone from attendance_policies p where p.org_id = ${v.orgId!}), 'Asia/Kolkata')`
    return tx<{ id: string }[]>`select app.attendance_request_correction(${v.orgId!}, ${v.date!},
      (${v.date!}::date + ${time(v.checkIn)}::time) at time zone ${zone}, (${v.date!}::date + ${time(v.checkOut)}::time) at time zone ${zone}, ${v.reason!.trim()}) as id`
  })
  return r.id
}

export async function requestLeave(ctx: Ctx, v: { orgId?: string; kind?: string; leaveType?: string; from?: string; to?: string; reason?: string }) {
  const errs: Record<string, string[]> = {}
  if (!UUID_RE.test(v.orgId ?? '')) errs.orgId = ['Choose the company.']
  if (!['leave', 'field_duty', 'official_visit'].includes(v.kind ?? '')) errs.kind = ['Choose the type of request.']
  if (!DATE_RE.test(v.from ?? '')) errs.from = ['Choose the first day.']
  if (!DATE_RE.test(v.to ?? '') || (v.to ?? '') < (v.from ?? '')) errs.to = ['Choose a last day on or after the first day.']
  if ((v.reason?.trim().length ?? 0) < 3) errs.reason = ['Give a reason.']
  if (Object.keys(errs).length) throw invalid('Please correct the highlighted fields.', errs)
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.attendance_request_leave(${v.orgId!}, ${v.kind!}, ${v.leaveType ?? null}, ${v.from!}, ${v.to!}, ${v.reason!.trim()}) as id`)
  return r.id
}

/** Monthly summary per person. "No record" is a count of working days with nothing recorded: it is not treated as absent. */
export async function attendanceMonthly(ctx: Ctx, f: { orgIds: string[]; month?: string; departmentId?: string }) {
  const allowed = f.orgIds.filter((o) => orgsWith(ctx, 'attendance.view').includes(o) || reviewOrgs(ctx).includes(o))
  if (!allowed.length) throw forbidden()
  const month = /^\d{4}-\d{2}$/.test(f.month ?? '') ? f.month! : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 7)
  const dept = UUID_RE.test(f.departmentId ?? '') ? f.departmentId! : null
  const rows = await run(ctx, (tx) => tx<{ user_id: string; full_name: string; employee_id: string; org_name: string; department: string | null; present: number; late: number; half_day: number; leave: number; field_duty: number; official_visit: number; absent: number; late_minutes: number; early_minutes: number; worked_minutes: number; pending_review: number; no_record: number }[]>`
    with days as (select d::date as d from generate_series(${month + '-01'}::date, least((${month + '-01'}::date + interval '1 month' - interval '1 day')::date, (now() at time zone 'Asia/Kolkata')::date), interval '1 day') d)
    select u.id as user_id, u.full_name, u.employee_id, o.name as org_name, dp.name as department,
           count(*) filter (where r.status = 'present')::int as present, count(*) filter (where r.status = 'late')::int as late, count(*) filter (where r.status = 'half_day')::int as half_day,
           count(*) filter (where r.status = 'leave')::int as leave, count(*) filter (where r.status = 'field_duty')::int as field_duty, count(*) filter (where r.status = 'official_visit')::int as official_visit,
           count(*) filter (where r.status = 'absent')::int as absent,
           coalesce(sum(r.late_minutes), 0)::int as late_minutes, coalesce(sum(r.early_minutes), 0)::int as early_minutes,
           coalesce(sum(greatest(0, extract(epoch from r.check_out_at - r.check_in_at) / 60 - r.break_minutes)), 0)::int as worked_minutes,
           count(*) filter (where r.review_status = 'pending')::int as pending_review,
           count(*) filter (where r.id is null and not (extract(dow from days.d)::int = any(coalesce(pol.weekly_off, '{0}'))))::int as no_record
      from organization_memberships m join user_profiles u on u.id = m.user_id and u.account_status = 'active' join organizations o on o.id = m.org_id
      left join departments dp on dp.id = m.department_id left join attendance_policies pol on pol.org_id = m.org_id
      cross join days left join attendance_records r on r.org_id = m.org_id and r.user_id = u.id and r.work_date = days.d
     where m.is_active and m.org_id = any(${tx.array(allowed)}::uuid[]) and (${dept}::uuid is null or m.department_id = ${dept}::uuid)
     group by u.id, u.full_name, u.employee_id, o.name, dp.name order by o.name, u.full_name`)
  const byDept = new Map<string, { department: string; people: number; present: number; late: number; half_day: number; leave: number; absent: number; no_record: number }>()
  for (const r of rows) {
    const k = `${r.org_name} · ${r.department ?? 'No department'}`
    const d = byDept.get(k) ?? { department: k, people: 0, present: 0, late: 0, half_day: 0, leave: 0, absent: 0, no_record: 0 }
    d.people++; d.present += r.present; d.late += r.late; d.half_day += r.half_day; d.leave += r.leave; d.absent += r.absent; d.no_record += r.no_record
    byDept.set(k, d)
  }
  return { month, rows, departments: [...byDept.values()] }
}

export async function attendanceSettings(ctx: Ctx, orgId: string) {
  return run(ctx, async (tx) => {
    await tx`insert into attendance_policies (org_id) values (${orgId}) on conflict (org_id) do nothing`
    const [policy] = await tx<{ org_id: string; timezone: string; work_start: string; work_end: string; grace_minutes: number; half_day_minutes: number; max_gps_accuracy_m: number; require_gps: boolean; require_ip: boolean; require_qr: boolean; require_photo: boolean; weekly_off: number[]; leave_types: string[] }[]>`
      select org_id, timezone, to_char(work_start, 'HH24:MI') as work_start, to_char(work_end, 'HH24:MI') as work_end, grace_minutes, half_day_minutes, max_gps_accuracy_m, require_gps, require_ip, require_qr, require_photo, weekly_off, leave_types from attendance_policies where org_id = ${orgId}`
    const offices = await tx<{ id: string; name: string; latitude: number | null; longitude: number | null; radius_m: number; allowed_ips: string[]; is_active: boolean }[]>`select * from app.attendance_office_settings(${orgId})`
    return { policy, offices }
  })
}

const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-f:]+(\/\d{1,3})?$/i
export async function saveOffice(ctx: Ctx, orgId: string, id: string | null, v: Record<string, string | undefined>) {
  const errs: Record<string, string[]> = {}
  const name = v.name?.trim() ?? ''
  if (name.length < 2) errs.name = ['Enter the office name.']
  const lat = num(v.latitude, -90, 90); const lng = num(v.longitude, -180, 180); const radius = num(v.radius, 10, 5000) ?? 150
  if ((v.latitude && lat === null)) errs.latitude = ['Latitude must be between -90 and 90.']
  if ((v.longitude && lng === null)) errs.longitude = ['Longitude must be between -180 and 180.']
  if ((lat === null) !== (lng === null)) errs.longitude = ['Enter both latitude and longitude, or neither.']
  const ips = (v.allowedIps ?? '').split(/[\s,]+/).filter(Boolean)
  if (ips.some((i) => !CIDR_RE.test(i))) errs.allowedIps = ['Enter public IP addresses or ranges, separated by commas.']
  if (Object.keys(errs).length) throw invalid('Please correct the highlighted fields.', errs)
  await run(ctx, (tx) => id
    ? tx`update attendance_offices set name = ${name}, latitude = ${lat}, longitude = ${lng}, radius_m = ${radius}, allowed_ips = ${ips}::cidr[] where id = ${id} and org_id = ${orgId}`
    : tx`insert into attendance_offices (org_id, name, latitude, longitude, radius_m, allowed_ips) values (${orgId}, ${name}, ${lat}, ${lng}, ${radius}, ${ips}::cidr[])`)
}
export async function setOfficeActive(ctx: Ctx, id: string, active: boolean) {
  await run(ctx, (tx) => tx`update attendance_offices set is_active = ${active} where id = ${id}`)
}

export async function savePolicy(ctx: Ctx, orgId: string, v: Record<string, string | undefined>) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/
  const errs: Record<string, string[]> = {}
  if (!time.test(v.workStart ?? '')) errs.workStart = ['Enter a start time.']
  if (!time.test(v.workEnd ?? '')) errs.workEnd = ['Enter an end time.']
  const grace = num(v.graceMinutes, 0, 240); const half = num(v.halfDayMinutes, 0, 720); const acc = num(v.maxAccuracy, 10, 5000)
  if (grace === null) errs.graceMinutes = ['Enter 0 to 240 minutes.']
  if (half === null) errs.halfDayMinutes = ['Enter 0 to 720 minutes.']
  if (acc === null) errs.maxAccuracy = ['Enter 10 to 5000 metres.']
  if (Object.keys(errs).length) throw invalid('Please correct the highlighted fields.', errs)
  const weekly = (v.weeklyOff ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6 && (v.weeklyOff ?? '').trim() !== '')
  const types = (v.leaveTypes ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20)
  await run(ctx, (tx) => tx`insert into attendance_policies (org_id) values (${orgId}) on conflict (org_id) do nothing`)
  const r = await run(ctx, (tx) => tx`update attendance_policies set work_start = ${v.workStart!}::time, work_end = ${v.workEnd!}::time, grace_minutes = ${grace!}, half_day_minutes = ${half!}, max_gps_accuracy_m = ${acc!},
      require_gps = ${v.requireGps === 'on'}, require_ip = ${v.requireIp === 'on'}, require_qr = ${v.requireQr === 'on'}, require_photo = ${v.requirePhoto === 'on'},
      weekly_off = ${weekly}::int[], leave_types = ${types}, updated_at = now() where org_id = ${orgId}`)
  if (r.count === 0) throw forbidden()
}

/** A new short-lived office QR, as an image. Only the hash is stored; the token goes into the address the phone opens. */
export async function issueOfficeQr(ctx: Ctx, officeId: string, baseUrl: string) {
  if (!UUID_RE.test(officeId)) throw invalid('Choose an office.')
  const token = randomBytes(24).toString('base64url')
  const [r] = await run(ctx, (tx) => tx<{ expires_at: Date }[]>`select app.attendance_issue_qr(${officeId}, ${hashQr(token)}, 45) as expires_at`)
  const url = `${baseUrl.replace(/\/$/, '')}/attendance?qr=${token}`
  return { dataUrl: await QRCode.toDataURL(url, { margin: 1, width: 320 }), expiresAt: r.expires_at, url }
}

export async function listKioskOffices(ctx: Ctx) {
  const orgs = orgsWith(ctx, 'attendance.manage')
  if (!orgs.length) throw forbidden()
  return run(ctx, (tx) => tx<{ id: string; name: string; org_name: string }[]>`
    select a.id, a.name, o.name as org_name from attendance_offices a join organizations o on o.id = a.org_id where a.is_active and a.org_id = any(${tx.array(orgs)}::uuid[]) order by o.name, a.name`)
}
