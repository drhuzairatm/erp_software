/** Phase 1 completion and Phase 2: announcements, preferences, manual clearance, quarantine, employee documents and profiles. Fictional data. */
import { createServer, type Server } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { hasPerm } from '../support/perm'
import { getStorage } from '@/lib/storage'
import { ServiceError } from '@/lib/errors'
import * as admin from '@/services/admin'
import * as secure from '@/services/secure-files'
import * as notify from '@/services/staff-notifications'
import * as tasks from '@/services/tasks'
import { adminSql, as, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string; let GRD: string
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
const pdf = () => new File([new TextEncoder().encode(`%PDF-1.4\n% ${rand()}\n%%EOF`)], 'employee.pdf', { type: 'application/pdf' })
async function refuses(p: Promise<unknown>, text?: string) {
  try { await p } catch (e) {
    expect(e).toBeInstanceOf(ServiceError)
    if (text) expect(`${(e as ServiceError).kind} ${(e as ServiceError).message}`).toContain(text)
    return
  }
  throw new Error('expected a refusal')
}
beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql().end() })

describe('announcements', () => {
  it('a manager publishes; each active member is told; the other company sees nothing; a counsellor cannot publish', async () => {
    const title = `Fictional notice ${rand()}`
    const mgr = await ctxFor('edx.manager@demo.test')
    await notify.publishAnnouncement(mgr, { orgId: EDX, title, body: 'Office closes early on a fictional day.', severity: 'warning' })
    const list = await notify.listMyNotifications(await ctxFor('edx.counsellor@demo.test'), { unread: true })
    expect(list.rows.some((r) => r.event_key === 'announcement_published' && r.href === '/announcements')).toBe(true)
    const seen = await notify.listAnnouncements(await ctxFor('edx.counsellor@demo.test'))
    expect(seen.rows.some((a) => a.title === title)).toBe(true)
    const other = await notify.listAnnouncements(await ctxFor('grd.counsellor@demo.test'))
    expect(other.rows.some((a) => a.title === title)).toBe(false)
    await refuses(notify.publishAnnouncement(await ctxFor('edx.counsellor@demo.test'), { orgId: EDX, title: 'Not allowed', body: 'Not allowed.', severity: 'info' }), 'forbidden')
    await refuses(notify.publishAnnouncement(mgr, { orgId: GRD, title: 'Other company', body: 'Not allowed.', severity: 'info' }), 'forbidden')
    await refuses(notify.publishAnnouncement(mgr, { orgId: EDX, title: 'x', body: '', severity: 'info' }))
    const [log] = await adminSql()`select count(*)::int as n from audit_logs where action = 'announcement_published' and after_data ->> 'title' = ${title}`
    expect(log.n).toBe(1)
  })

  it('withdrawing hides it from staff but not from publishers, and only a publisher can withdraw', async () => {
    const title = `Withdrawn notice ${rand()}`
    const mgr = await ctxFor('edx.manager@demo.test')
    const id = await notify.publishAnnouncement(mgr, { orgId: EDX, title, body: 'A fictional mistake.', severity: 'info' })
    await refuses(notify.withdrawAnnouncement(await ctxFor('edx.counsellor@demo.test'), id), 'forbidden')
    await notify.withdrawAnnouncement(mgr, id)
    expect((await notify.listAnnouncements(await ctxFor('edx.counsellor@demo.test'))).rows.some((a) => a.title === title)).toBe(false)
    expect((await notify.listAnnouncements(mgr)).rows.find((a) => a.title === title)?.withdrawn_at).toBeTruthy()
  })
})

describe('notification preferences', () => {
  const ME = 'edx.counsellor2@demo.test'
  afterEach(async () => { await adminSql()`delete from staff_notification_preferences where user_id = ${await userId(ME)}` })

  it('turning off a category stops its notifications; a person only reads and writes their own', async () => {
    const me = await ctxFor(ME)
    await notify.setMyNotificationPreference(me, 'tasks', false, false)
    expect((await notify.myNotificationPreferences(me)).find((p) => p.key === 'tasks')).toMatchObject({ in_app: false, email: false })
    expect((await notify.myNotificationPreferences(await ctxFor('edx.counsellor@demo.test'))).find((p) => p.key === 'tasks')).toMatchObject({ in_app: true })
    const before = (await notify.listMyNotifications(me)).total
    const mgr = await ctxFor('edx.manager@demo.test')
    await tasks.createTask(mgr, { orgId: EDX, title: `Muted ${rand()}`, assignedTo: me.userId })
    expect((await notify.listMyNotifications(me)).total).toBe(before)
    await refuses(notify.setMyNotificationPreference(me, 'nonsense', true, true))
    await expectDbError(as(ME, (tx) => tx`insert into staff_notification_preferences (user_id, category) values (${me.userId}, 'documents')`), '42501')
  })

  it('email can be off while in-app stays on; a critical announcement still arrives when muted', async () => {
    const me = await ctxFor(ME)
    await notify.setMyNotificationPreference(me, 'tasks', true, false)
    const title = `No email ${rand()}`
    const id = await tasks.createTask(await ctxFor('edx.manager@demo.test'), { orgId: EDX, title, assignedTo: me.userId })
    const [n] = await adminSql()`select email_status from staff_notifications where subject_id = ${id} and user_id = ${me.userId} and event_key = 'task_assigned'`
    expect(n.email_status).toBe('none')
    await notify.setMyNotificationPreference(me, 'chat', false, false)
    const before = (await notify.listMyNotifications(me)).total
    await notify.publishAnnouncement(await ctxFor('edx.manager@demo.test'), { orgId: EDX, title: `Critical ${rand()}`, body: 'Fictional critical notice.', severity: 'critical' })
    expect((await notify.listMyNotifications(me)).total).toBe(before + 1)
  })
})

describe('secure files: clearance and quarantine', () => {
  let scanner: Server; let port = 0
  afterEach(async () => { delete process.env.CLAMAV_HOST; delete process.env.CLAMAV_PORT; await new Promise<void>((r) => (scanner ? scanner.close(() => r()) : r())); scanner = undefined as never })
  const failingScanner = async () => {
    scanner = createServer((c) => { c.on('data', () => {}); c.destroy() })
    await new Promise<void>((r) => scanner.listen(0, '127.0.0.1', () => r()))
    port = (scanner.address() as { port: number }).port
    process.env.CLAMAV_HOST = '127.0.0.1'; process.env.CLAMAV_PORT = String(port)
  }
  const taskFile = async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const taskId = await tasks.createTask(mgr, { orgId: EDX, title: `Clearance ${rand()}`, assignedTo: await userId('edx.counsellor@demo.test') })
    await secure.uploadSecureFile(mgr, 'task', taskId, pdf())
    const [f] = await secure.listSecureFiles(mgr, 'task', taskId)
    return { taskId, file: f, mgr }
  }

  it('with a scanner configured, a file whose scan failed is held until cleared; the refusal is audited', async () => {
    await failingScanner()
    const { file, mgr } = await taskFile()
    expect(file.scan_status).toBe('scan_failed')
    expect(await secure.openSecureFile(mgr, file.id)).toBeNull()
    const [log] = await adminSql()`select outcome, metadata from audit_logs where entity_id = ${file.id} and action = 'file_download' order by id desc limit 1`
    expect(log).toMatchObject({ outcome: 'denied', metadata: { reason: 'awaiting_scan' } })
    const md = await ctxFor('md@demo.test')
    await secure.clearSecureFile(md, file.id, 'Fictional: checked by hand')
    expect(await secure.openSecureFile(mgr, file.id)).toBeTruthy()
    const [row] = await adminSql()`select scan_status, cleared_by, clear_reason from secure_files where id = ${file.id}`
    expect(row).toMatchObject({ scan_status: 'manually_cleared', cleared_by: md.userId })
    const [a] = await adminSql()`select count(*)::int as n from audit_logs where entity_id = ${file.id} and action = 'secure_file_manually_cleared'`
    expect(a.n).toBe(1)
  })

  it('without a scanner, the file stays labelled not scanned: nothing pretends it was scanned', async () => {
    const { file, mgr } = await taskFile()
    expect(file.scan_status).toBe('not_scanned')
    expect(await secure.openSecureFile(mgr, file.id)).toBeTruthy()
  })

  it('clearance needs the permission, a reason, someone other than the uploader, and never covers infected files', async () => {
    const { file, mgr } = await taskFile()
    const md = await ctxFor('md@demo.test')
    await refuses(secure.clearSecureFile(await ctxFor('edx.counsellor@demo.test'), file.id, 'Not allowed here'), 'forbidden')
    await refuses(secure.clearSecureFile(md, file.id, 'no'))
    const { file: own } = await (async () => {
      const taskId = await tasks.createTask(md, { orgId: EDX, title: `Own ${rand()}` })
      await secure.uploadSecureFile(md, 'task', taskId, pdf())
      return { file: (await secure.listSecureFiles(md, 'task', taskId))[0] }
    })()
    await refuses(secure.clearSecureFile(md, own.id, 'Clearing my own file'), 'forbidden')
    expect(mgr).toBeTruthy()
    await adminSql()`update secure_files set scan_status = 'infected' where id = ${file.id}`
    await refuses(secure.clearSecureFile(md, file.id, 'Trying an infected file'))
    expect(await secure.openSecureFile(md, file.id)).toBeNull()
  })

  it('upload and download history is visible to those who may change the record, and no one else', async () => {
    const { taskId, file, mgr } = await taskFile()
    await secure.openSecureFile(mgr, file.id)
    const h = await secure.secureFileHistory(mgr, 'task', taskId)
    expect(h.map((e) => e.action)).toEqual(expect.arrayContaining(['file_download', 'secure_file_uploaded']))
    await refuses(secure.secureFileHistory(await ctxFor('grd.manager@demo.test'), 'task', taskId), 'forbidden')
  })
})

describe('employee documents', () => {
  it('the employee and their staff managers can read them; a colleague and the other company cannot', async () => {
    const me = await ctxFor('edx.counsellor@demo.test')
    await secure.uploadSecureFile(me, 'employee', me.userId, pdf())
    const [f] = await secure.listSecureFiles(me, 'employee', me.userId)
    expect(f.can_remove).toBe(true)
    expect(await secure.openSecureFile(me, f.id)).toBeTruthy()
    expect(await secure.openSecureFile(await ctxFor('admin@demo.test'), f.id)).toBeTruthy()
    expect(await secure.openSecureFile(await ctxFor('edx.manager@demo.test'), f.id)).toBeNull() // a manager without staff administration
    expect(await secure.openSecureFile(await ctxFor('edx.counsellor2@demo.test'), f.id)).toBeNull()
    expect(await secure.openSecureFile(await ctxFor('grd.manager@demo.test'), f.id)).toBeNull()
    expect(await secure.listSecureFiles(await ctxFor('edx.counsellor2@demo.test'), 'employee', me.userId)).toEqual([])
    await refuses(secure.uploadSecureFile(await ctxFor('edx.counsellor2@demo.test'), 'employee', me.userId, pdf()), 'forbidden')
    const [row] = await adminSql()`select storage_key from secure_files where id = ${f.id}`
    expect(await (await getStorage()).get(row.storage_key)).toBeTruthy()
  })
})

describe('employee profiles', () => {
  it('an employee edits personal details, not email, designation, role or status', async () => {
    const me = await ctxFor('edx.counsellor2@demo.test')
    await admin.updateMyProfile(me, { firstName: 'Fict', lastName: 'Ional', phone: '+91 90000 11111', secondaryPhone: '+91 90000 22222', addressLine: '1 Fictional Road', city: 'Testville' })
    const p = await admin.getMyProfile(me)
    expect(p.user).toMatchObject({ first_name: 'Fict', last_name: 'Ional', secondary_phone: '+91 90000 22222', city: 'Testville' })
    expect(p.completion.percent).toBeGreaterThan(0)
    expect(p.completion.missing).not.toContain('Address')
    await refuses(admin.updateMyProfile(me, { phone: 'not a phone!' }))
    await expectDbError(as('edx.counsellor2@demo.test', (tx) => tx`update user_profiles set job_title = 'Self promoted', first_name = 'x' where id = ${me.userId} returning id`.then((r) => { if (!r.length) throw Object.assign(new Error('no row'), { code: '42501' }) })), '42501')
    const history = await admin.staffProfileHistory(me, me.userId)
    expect(history.some((h) => h.fields?.includes('secondary_phone'))).toBe(true)
    await refuses(admin.staffProfileHistory(me, await userId('edx.counsellor@demo.test')), 'forbidden')
  })

  it('changing the MD display name and designation changes no permission and no role', async () => {
    const md = await ctxFor('md@demo.test')
    const [before] = await adminSql()`select full_name, display_name from user_profiles where id = ${md.userId}`
    const rolesBefore = await adminSql()`select org_id, role_id from organization_memberships where user_id = ${md.userId} order by org_id`
    const permsBefore = await hasPerm(md.userId, EDX, 'users.create_admin')
    expect(permsBefore).toBe(true)
    await admin.updateMyProfile(md, { displayName: 'Fictional Chief' })
    const [after] = await adminSql()`select full_name from user_profiles where id = ${md.userId}`
    expect(after.full_name).toBe('Fictional Chief')
    expect(await adminSql()`select org_id, role_id from organization_memberships where user_id = ${md.userId} order by org_id`).toEqual(rolesBefore)
    expect(await hasPerm(md.userId, EDX, 'users.create_admin')).toBe(true)
    expect((await ctxFor('md@demo.test')).memberships.every((m) => m.roleKey === 'md')).toBe(true)
    await adminSql()`update user_profiles set display_name = null, full_name = ${before.full_name} where id = ${md.userId}`
  })

  it('a designation sets the job title and leaves the role alone; only a company administrator can set it, and only from that company', async () => {
    const mgr = await ctxFor('md@demo.test')
    const target = await userId('edx.counsellor@demo.test')
    const [d] = await adminSql()`select id, name from designations where org_id = ${EDX} and name = 'Executive Assistant'`
    const [gd] = await adminSql()`select id from designations where org_id = ${GRD} limit 1`
    const roleBefore = await adminSql()`select role_id from organization_memberships where user_id = ${target} and org_id = ${EDX}`
    await admin.setStaffDesignation(mgr, target, EDX, d.id)
    const [row] = await adminSql()`select u.job_title, m.designation_id, m.role_id from user_profiles u join organization_memberships m on m.user_id = u.id and m.org_id = ${EDX} where u.id = ${target}`
    expect(row).toMatchObject({ job_title: 'Executive Assistant', designation_id: d.id, role_id: roleBefore[0].role_id })
    await refuses(admin.setStaffDesignation(mgr, target, EDX, gd.id))
    await refuses(admin.setStaffDesignation(await ctxFor('grd.manager@demo.test'), target, GRD, gd.id), 'forbidden')
    await refuses(admin.setStaffDesignation(await ctxFor('edx.manager@demo.test'), target, EDX, d.id), 'forbidden')
    await refuses(admin.setStaffDesignation(await ctxFor('edx.counsellor2@demo.test'), target, EDX, d.id), 'forbidden')
  })

  it('archiving: only after suspension or deactivation, with a reason; blocks sign-in; keeps the record', async () => {
    const md = await ctxFor('md@demo.test')
    const [org] = await adminSql()`select id from organizations where code = 'EDX'`
    const { randomUUID } = await import('node:crypto')
    const id = randomUUID()
    await adminSql()`insert into user_profiles (id, email, full_name, account_status) values (${id}, ${`archive-${rand()}@demo.test`}, 'Fictional Leaver', 'active')`
    const [role] = await adminSql()`select id from roles where org_id = ${org.id} and key = 'counsellor'`
    await adminSql()`insert into organization_memberships (user_id, org_id, role_id) values (${id}, ${org.id}, ${role.id})`
    await refuses(admin.setStaffStatus(md, id, 'archived', 'Too early'))
    await admin.setStaffStatus(md, id, 'terminated', 'Fictional leaver')
    await refuses(admin.setStaffStatus(md, id, 'archived', ''))
    expect(await admin.setStaffStatus(md, id, 'archived', 'Fictional: left long ago')).toBe('archived')
    const [u] = await adminSql()`select is_active, account_status from user_profiles where id = ${id}`
    expect(u).toEqual({ is_active: false, account_status: 'archived' })
    await refuses(admin.setStaffStatus(await ctxFor('edx.manager@demo.test'), id, 'active'), 'forbidden')
  })
})
