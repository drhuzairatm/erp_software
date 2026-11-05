/** Phase 3: attendance. A failed signal never refuses attendance or marks anyone absent; it goes to manual review. Fictional data. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { anonymous } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as att from '@/services/attendance'
import * as secure from '@/services/secure-files'
import { adminSql, as, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string; let GRD: string; let office: string
const A = 'edx.counsellor@demo.test'; const B = 'edx.counsellor2@demo.test'; const MGR = 'edx.manager@demo.test'; const GMGR = 'grd.manager@demo.test'
const OFFICE = { lat: 28.6139, lng: 77.209 }
const near = { lat: OFFICE.lat + 0.0002, lng: OFFICE.lng, accuracy: 20 }
const far = { lat: OFFICE.lat + 1, lng: OFFICE.lng, accuracy: 20 }
const jpeg = () => new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, ...Array(64).fill(Math.floor(Math.random() * 255))])], 'attendance.jpg', { type: 'image/jpeg' })
async function refuses(p: Promise<unknown>, text?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (text) expect(`${(e as ServiceError).kind} ${(e as ServiceError).message}`).toContain(text); return }
  throw new Error('expected a refusal')
}
const reset = async () => {
  const a = adminSql()
  await a`delete from secure_files where context_type = 'attendance'`.catch(() => {})
  await a`delete from attendance_events`; await a`delete from attendance_corrections`; await a`delete from attendance_leaves`; await a`delete from attendance_records`
  await a`update attendance_policies set require_gps = true, require_ip = false, require_qr = false, require_photo = true, work_start = '19:59', work_end = '23:59', grace_minutes = 240, half_day_minutes = 0`
}
// The default policy here means "not late" at any hour except the last minute of the day (start + grace = 23:59).
beforeAll(async () => {
  EDX = await orgId('EDX'); GRD = await orgId('GRD')
  const a = adminSql()
  await a`insert into attendance_policies (org_id) values (${EDX}), (${GRD}) on conflict do nothing`
  const [o] = await a`insert into attendance_offices (org_id, name, latitude, longitude, radius_m, allowed_ips) values (${EDX}, ${`Fictional Office ${Date.now()}`}, ${OFFICE.lat}, ${OFFICE.lng}, 150, '{203.0.113.0/24}') returning id`
  office = o.id
})
beforeEach(reset)
afterAll(async () => { await reset(); await adminSql().end() })

describe('marking', () => {
  it('all signals good: no flags, no review; times come from the server; sequence is enforced', async () => {
    const me = await ctxFor(A)
    const r = await att.markAttendance(me, { orgId: EDX, action: 'check_in', ...near, photo: jpeg() })
    expect(r).toMatchObject({ flags: [], needs_review: false, status: 'present' })
    const [rec] = await adminSql()`select *, now() - check_in_at < interval '1 minute' as fresh from attendance_records where id = ${r.record_id}`
    expect(rec.fresh).toBe(true)
    expect(rec.office_id).toBe(office)
    const [e] = await adminSql()`select * from attendance_events where id = ${r.event_id}`
    expect(e.photo_file_id).toBeTruthy(); expect(e.distance_m).toBeLessThan(150); expect(e.method).toBe('mobile')
    await refuses(att.markAttendance(me, { orgId: EDX, action: 'check_in', ...near, photo: jpeg() }), 'already checked in')
    await att.markAttendance(me, { orgId: EDX, action: 'break_start', ...near })
    await refuses(att.markAttendance(me, { orgId: EDX, action: 'break_start', ...near }), 'already on a break')
    await att.markAttendance(me, { orgId: EDX, action: 'break_end', ...near })
    await refuses(att.markAttendance(me, { orgId: EDX, action: 'break_end', ...near }), 'not on a break')
    const out = await att.markAttendance(me, { orgId: EDX, action: 'check_out', ...near, photo: jpeg() })
    expect(out.flags).toEqual([])
    await refuses(att.markAttendance(me, { orgId: EDX, action: 'check_out', ...near }), 'already checked out')
  })

  it('check-out and break need a check-in first', async () => {
    await refuses(att.markAttendance(await ctxFor(A), { orgId: EDX, action: 'check_out', ...near }), 'Check in first')
  })

  it('a failed or missing signal raises flags and review, and never refuses or marks absent', async () => {
    const me = await ctxFor(A)
    const r = await att.markAttendance(me, { orgId: EDX, action: 'check_in', ...far })
    expect(r.flags).toEqual(expect.arrayContaining(['outside_geofence', 'photo_missing']))
    expect(r.needs_review).toBe(true)
    expect(r.status).toBe('present')
    const b = await att.markAttendance(await ctxFor(B), { orgId: EDX, action: 'check_in', photo: jpeg() })
    expect(b.flags).toEqual(['no_gps'])
    const [n] = await adminSql()`select count(*)::int as n from attendance_records where status = 'absent'`
    expect(n.n).toBe(0)
  })

  it('poor accuracy and IP allowlist flag only when the policy asks', async () => {
    const me = await ctxFor(A)
    await adminSql()`update attendance_policies set require_ip = true where org_id = ${EDX}`
    const r = await att.markAttendance({ ...me, ip: '198.51.100.7' }, { orgId: EDX, action: 'check_in', ...near, accuracy: 5000, photo: jpeg() })
    expect(r.flags).toEqual(expect.arrayContaining(['low_gps_accuracy', 'ip_not_allowed']))
    const ok = await att.markAttendance({ ...(await ctxFor(B)), ip: '203.0.113.9' }, { orgId: EDX, action: 'check_in', ...near, photo: jpeg() })
    expect(ok.flags).toEqual([])
  })

  it('late is computed from the policy; an early check-out and a short day are recorded', async () => {
    await adminSql()`update attendance_policies set work_start = '00:00', grace_minutes = 0, work_end = '23:59', half_day_minutes = 240 where org_id = ${EDX}`
    const me = await ctxFor(A)
    const r = await att.markAttendance(me, { orgId: EDX, action: 'check_in', ...near, photo: jpeg() })
    expect(r.status).toBe('late')
    const out = await att.markAttendance(me, { orgId: EDX, action: 'check_out', ...near, photo: jpeg() })
    expect(out.status).toBe('half_day')
    const [rec] = await adminSql()`select late_minutes, early_minutes from attendance_records where id = ${r.record_id}`
    expect(rec.late_minutes).toBeGreaterThanOrEqual(0)
    expect(rec.early_minutes).toBeGreaterThanOrEqual(0)
  })

  it('someone cannot mark attendance in a company they do not belong to, or write attendance rows directly', async () => {
    await refuses(att.markAttendance(await ctxFor(A), { orgId: GRD, action: 'check_in', ...near }), 'forbidden')
    const uid = await userId(A)
    await expectDbError(as(A, (tx) => tx`insert into attendance_records (org_id, user_id, work_date) values (${EDX}, ${uid}, current_date)`), '42501')
    await expectDbError(as(A, (tx) => tx`update attendance_events set flags = '{}'`), '42501')
    await expectDbError(as(A, (tx) => tx`select * from attendance_qr_tokens`), '42501')
    await expectDbError(as(A, (tx) => tx`select allowed_ips from attendance_offices`), '42501')
  })

  it('field duty approved for today removes location flags', async () => {
    const today = (await adminSql()`select (now() at time zone 'Asia/Kolkata')::date::text as d`)[0].d
    const me = await ctxFor(A)
    const id = await att.requestLeave(me, { orgId: EDX, kind: 'field_duty', from: today, to: today, reason: 'Fictional site visit' })
    await att.decideLeave(await ctxFor(MGR), id, 'approved')
    const r = await att.markAttendance(me, { orgId: EDX, action: 'check_in', ...far, photo: jpeg() })
    expect(r.flags).toEqual([])
    expect(r.status).toBe('field_duty')
  })
})

describe('office QR', () => {
  const issue = async () => {
    const q = await att.issueOfficeQr(await ctxFor('md@demo.test'), office, 'http://fictional.test')
    expect(q.dataUrl.startsWith('data:image/png')).toBe(true)
    return new URL(q.url).searchParams.get('qr')!
  }
  beforeEach(async () => { await adminSql()`update attendance_policies set require_qr = true where org_id = ${EDX}` })

  it('a valid code passes; only its hash is stored; the same person cannot reuse it; a colleague can use it once', async () => {
    const token = await issue()
    const [row] = await adminSql()`select token_hash from attendance_qr_tokens order by issued_at desc limit 1`
    expect(row.token_hash).toBe(att.hashQr(token)); expect(row.token_hash).not.toContain(token)
    const r = await att.markAttendance(await ctxFor(A), { orgId: EDX, action: 'check_in', ...near, qr: token, photo: jpeg() })
    expect(r.flags).toEqual([])
    const [e] = await adminSql()`select qr_verified from attendance_events where id = ${r.event_id}`
    expect(e.qr_verified).toBe(true)
    const b = await att.markAttendance(await ctxFor(B), { orgId: EDX, action: 'check_in', ...near, qr: token, photo: jpeg() })
    expect(b.flags).toEqual([])
    const replay = await att.markAttendance(await ctxFor(A), { orgId: EDX, action: 'break_start', ...near, qr: token })
    expect(replay.flags).toEqual([])
    await adminSql()`delete from attendance_events where record_id = ${b.record_id}`; await adminSql()`delete from attendance_records where id = ${b.record_id}`
    const again = await att.markAttendance(await ctxFor(B), { orgId: EDX, action: 'check_in', ...near, qr: token, photo: jpeg() })
    expect(again.flags).toEqual(['qr_replayed'])
  })

  it('an expired, forged or missing code raises a flag and never refuses', async () => {
    const token = await issue()
    await adminSql()`update attendance_qr_tokens set expires_at = now() - interval '1 minute' where token_hash = ${att.hashQr(token)}`
    expect((await att.markAttendance(await ctxFor(A), { orgId: EDX, action: 'check_in', ...near, qr: token, photo: jpeg() })).flags).toEqual(['qr_expired'])
    expect((await att.markAttendance(await ctxFor(B), { orgId: EDX, action: 'check_in', ...near, qr: 'forged-token-forged-token-forged', photo: jpeg() })).flags).toEqual(['qr_invalid'])
    expect((await att.markAttendance(await ctxFor(MGR), { orgId: EDX, action: 'check_in', ...near, photo: jpeg() })).flags).toEqual(['qr_missing'])
  })

  it('a code from the other company is not valid here; only attendance.manage can issue one', async () => {
    const [g] = await adminSql()`insert into attendance_offices (org_id, name) values (${GRD}, ${`Other ${Date.now()}`}) returning id`
    const q = await att.issueOfficeQr(await ctxFor('md@demo.test'), g.id, 'http://fictional.test')
    const r = await att.markAttendance(await ctxFor(A), { orgId: EDX, action: 'check_in', ...near, qr: new URL(q.url).searchParams.get('qr')!, photo: jpeg() })
    expect(r.flags).toEqual(['qr_invalid'])
    await refuses(att.issueOfficeQr(await ctxFor(A), office, 'http://fictional.test'), 'forbidden')
    await refuses(att.issueOfficeQr(await ctxFor(GMGR), office, 'http://fictional.test'), 'forbidden')
  })
})

describe('review, correction, leave', () => {
  it('a reviewer decides; the person is told; nobody reviews their own; other company is refused; decisions are audited', async () => {
    const me = await ctxFor(MGR)
    const own = await att.markAttendance(me, { orgId: EDX, action: 'check_in', ...far })
    await refuses(att.decideReview(me, own.record_id, 'accepted'), 'forbidden')
    const a = await ctxFor(A)
    const r = await att.markAttendance(a, { orgId: EDX, action: 'check_in', ...far })
    const q = await att.attendanceWorkQueue(me, [EDX])
    expect(q.reviews.find((x) => x.id === r.record_id)?.flags).toEqual(expect.arrayContaining(['outside_geofence']))
    await refuses(att.decideReview(await ctxFor(GMGR), r.record_id, 'accepted'), 'forbidden')
    await refuses(att.decideReview(await ctxFor(B), r.record_id, 'accepted'), 'forbidden')
    await refuses(att.decideReview(me, r.record_id, 'not_accepted'))
    await att.decideReview(me, r.record_id, 'not_accepted', 'Fictional: could not confirm')
    const [rec] = await adminSql()`select review_status, status, reviewed_by from attendance_records where id = ${r.record_id}`
    expect(rec).toMatchObject({ review_status: 'not_accepted', status: 'present', reviewed_by: me.userId })
    const [n] = await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${a.userId} and event_key = 'attendance_review_decided' and subject_id = ${r.record_id}`
    expect(n.n).toBe(1)
    const [log] = await adminSql()`select count(*)::int as n from audit_logs where entity_type = 'attendance_records' and entity_id = ${r.record_id}`
    expect(log.n).toBeGreaterThan(0)
  })

  it('an approved correction changes the record and keeps its history; a refused one does not', async () => {
    const a = await ctxFor(A); const mgr = await ctxFor(MGR)
    const id = await att.requestCorrection(a, { orgId: EDX, date: '2026-11-02', checkIn: '09:30', checkOut: '18:00', reason: 'Fictional: phone was off' })
    await refuses(att.decideCorrection(a, id, 'approved'), 'forbidden')
    await att.decideCorrection(mgr, id, 'approved')
    const [rec] = await adminSql()`select id, to_char(check_in_at at time zone 'Asia/Kolkata', 'HH24:MI') as i, to_char(check_out_at at time zone 'Asia/Kolkata', 'HH24:MI') as o from attendance_records where user_id = ${a.userId} and work_date = '2026-11-02'`
    expect(rec).toMatchObject({ i: '09:30', o: '18:00' })
    const [log] = await adminSql()`select count(*)::int as n from audit_logs where action = 'attendance_corrected' and entity_id = ${rec.id}`
    expect(log.n).toBe(1)
    await refuses(att.decideCorrection(mgr, id, 'rejected', 'Too late'), 'already')
    const two = await att.requestCorrection(a, { orgId: EDX, date: '2026-11-03', checkIn: '09:30', reason: 'Fictional: second' })
    await refuses(att.decideCorrection(mgr, two, 'rejected'))
    await att.decideCorrection(mgr, two, 'rejected', 'Fictional: no evidence')
    expect((await adminSql()`select count(*)::int as n from attendance_records where user_id = ${a.userId} and work_date = '2026-11-03'`)[0].n).toBe(0)
    await refuses(att.requestCorrection(a, { orgId: EDX, date: '2030-01-01', checkIn: '09:30', reason: 'Future date here' }), 'future')
    await refuses(att.requestCorrection(a, { orgId: EDX, date: '2026-11-03', reason: 'No times given' }))
  })

  it('approved leave fills each day; overlapping requests are refused; only own pending can be cancelled', async () => {
    const a = await ctxFor(A); const mgr = await ctxFor(MGR)
    const id = await att.requestLeave(a, { orgId: EDX, kind: 'leave', leaveType: 'Sick leave', from: '2026-10-05', to: '2026-10-07', reason: 'Fictional illness' })
    await refuses(att.requestLeave(a, { orgId: EDX, kind: 'leave', from: '2026-10-06', to: '2026-10-08', reason: 'Overlap here' }), 'already have')
    await refuses(att.decideLeave(await ctxFor(B), id, 'cancelled'), 'forbidden')
    await att.decideLeave(mgr, id, 'approved')
    expect((await adminSql()`select count(*)::int as n from attendance_records where user_id = ${a.userId} and status = 'leave' and work_date between '2026-10-05' and '2026-10-07'`)[0].n).toBe(3)
    await refuses(att.decideLeave(a, id, 'cancelled'), 'forbidden')
    await refuses(att.requestLeave(a, { orgId: EDX, kind: 'leave', from: '2026-10-10', to: '2026-10-09', reason: 'Reversed' }))
  })

  it('absent happens only when a reviewer records it, with a reason', async () => {
    const mgr = await ctxFor(MGR); const a = await ctxFor(A)
    await refuses(att.setAttendanceStatus(a, { orgId: EDX, userId: a.userId, date: '2026-09-01', status: 'present', note: 'Self service' }), 'forbidden')
    await refuses(att.setAttendanceStatus(mgr, { orgId: EDX, userId: a.userId, date: '2026-09-01', status: 'absent', note: '' }))
    await att.setAttendanceStatus(mgr, { orgId: EDX, userId: a.userId, date: '2026-09-01', status: 'absent', note: 'Fictional: confirmed by HR' })
    expect((await adminSql()`select status from attendance_records where user_id = ${a.userId} and work_date = '2026-09-01'`)[0].status).toBe('absent')
  })

  it('the daily job flags a missing check-out for review without marking absent; only the system can run it', async () => {
    const a = await ctxFor(A)
    const [r] = await adminSql()`insert into attendance_records (org_id, user_id, work_date, check_in_at, status) values (${EDX}, ${a.userId}, current_date - 1, now() - interval '1 day', 'present') returning id`
    await expectDbError(as(MGR, (tx) => tx`select app.attendance_daily()`), '42501')
    const [{ out }] = await anonymous((tx) => tx<{ out: { missingCheckouts: number } }[]>`select app.attendance_daily() as out`)
    expect(out.missingCheckouts).toBeGreaterThan(0)
    expect((await adminSql()`select status, review_status from attendance_records where id = ${r.id}`)[0]).toEqual({ status: 'present', review_status: 'pending' })
    const [n] = await adminSql()`select count(*)::int as n from staff_notifications where user_id = ${a.userId} and event_key = 'attendance_missing_checkout'`
    expect(n.n).toBeGreaterThan(0)
  })
})

describe('visibility', () => {
  it('a person sees their own; a colleague sees nothing; other company sees nothing; managers see theirs; photos follow the same rule', async () => {
    const a = await ctxFor(A)
    const r = await att.markAttendance(a, { orgId: EDX, action: 'check_in', ...near, photo: jpeg() })
    expect((await att.myAttendance(a)).today[0].id).toBe(r.record_id)
    expect((await att.myAttendance(await ctxFor(B))).today).toEqual([])
    await expect(as(B, (tx) => tx`select id from attendance_records`)).resolves.toEqual([])
    await expect(as(GMGR, (tx) => tx`select id from attendance_records`)).resolves.toEqual([])
    await expect(as(GMGR, (tx) => tx`select id from attendance_events`)).resolves.toEqual([])
    await refuses(att.attendanceToday(a, [EDX]), 'forbidden')
    await refuses(att.attendanceToday(await ctxFor(GMGR), [EDX]), 'forbidden')
    expect((await att.attendanceToday(await ctxFor(MGR), [EDX])).find((x) => x.user_id === a.userId)?.check_in_at).toBeTruthy()
    const [f] = await secure.listSecureFiles(a, 'attendance', r.record_id)
    expect(await secure.openSecureFile(a, f.id)).toBeTruthy()
    expect(await secure.openSecureFile(await ctxFor(MGR), f.id)).toBeTruthy()
    expect(await secure.openSecureFile(await ctxFor(B), f.id)).toBeNull()
    expect(await secure.openSecureFile(await ctxFor(GMGR), f.id)).toBeNull()
  })

  it('monthly report: counts from real records; "no record" is not absent; other company refused', async () => {
    const a = await ctxFor(A); const mgr = await ctxFor(MGR)
    await att.markAttendance(a, { orgId: EDX, action: 'check_in', ...near, photo: jpeg() })
    const month = (await adminSql()`select to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM') as m`)[0].m
    const rep = await att.attendanceMonthly(mgr, { orgIds: [EDX], month })
    const row = rep.rows.find((x) => x.user_id === a.userId)!
    expect(row.present + row.late).toBe(1)
    expect(row.absent).toBe(0)
    expect(rep.departments.reduce((n, d) => n + d.people, 0)).toBe(rep.rows.length)
    await refuses(att.attendanceMonthly(await ctxFor(GMGR), { orgIds: [EDX], month }), 'forbidden')
  })

  it('settings: only attendance.manage; IP allowlists stay private', async () => {
    const md = await ctxFor('md@demo.test')
    const s = await att.attendanceSettings(md, EDX)
    expect(s.offices.some((o) => o.allowed_ips.includes('203.0.113.0/24'))).toBe(true)
    await refuses(att.attendanceSettings(await ctxFor(A), EDX), 'forbidden')
    await refuses(att.saveOffice(await ctxFor(A), EDX, null, { name: 'Sneaky office' }), 'forbidden')
    await refuses(att.saveOffice(md, EDX, null, { name: 'Bad IP', allowedIps: 'not-an-ip' }))
    await refuses(att.saveOffice(md, EDX, null, { name: 'One coordinate', latitude: '10' }))
    await att.savePolicy(md, EDX, { workStart: '09:45', workEnd: '18:15', graceMinutes: '5', halfDayMinutes: '200', maxAccuracy: '100', requireGps: 'on', weeklyOff: '0,6', leaveTypes: 'Annual, Sick' })
    expect((await att.attendanceSettings(md, EDX)).policy).toMatchObject({ work_start: '09:45', grace_minutes: 5, weekly_off: [0, 6], leave_types: ['Annual', 'Sick'], require_photo: false })
    await refuses(att.savePolicy(md, EDX, { workStart: 'bad', workEnd: '18:15', graceMinutes: '5', halfDayMinutes: '200', maxAccuracy: '100' }))
  })
})
