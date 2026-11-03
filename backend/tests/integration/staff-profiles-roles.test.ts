/** Staff photos, employee IDs, reporting managers, role status and structure – with the existing anti-escalation rules intact. */
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/server/db'
import { ServiceError } from '@/server/errors'
import { getStorage } from '@/server/storage'
import * as admin from '@/server/services/admin'
import * as staffPhotos from '@/server/services/staff-photos'
import { adminSql, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string; let GRD: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}
const photo = async () => new File([new Uint8Array(await sharp({ create: { width: 800, height: 600, channels: 3, background: '#d7e0ea' } })
  .jpeg().withExif({ IFD0: { Artist: 'fictional' } }).toBuffer())], 'me.jpg', { type: 'image/jpeg' })
const roleId = async (org: string, key: string) => (await adminSql()`select id from roles where org_id = ${org} and key = ${key}`)[0].id as string

async function newStaff(org = EDX, roleKey = 'counsellor') {
  const mdCtx = await ctxFor('md@demo.test')
  const email = `staff.${rand()}${rand()}@example.test`
  const r = await admin.createStaff(mdCtx, { email, fullName: `Test Staff ${rand()}`, orgId: org, roleId: await roleId(org, roleKey) })
  return { id: r.userId, email }
}

describe('staff profiles', () => {
  it('every account has an employee ID; new accounts get the next number', async () => {
    const s = await newStaff()
    const [u] = await adminSql()`select employee_id from user_profiles where id = ${s.id}`
    expect(u.employee_id).toMatch(/^EMP-\d{5}$/)
    expect((await adminSql()`select count(*)::int as n from user_profiles where employee_id is null`)[0].n).toBe(0)
  })

  it('photo: square display + 256 thumbnail without metadata; administrator or the person may change it; colleagues only can view', async () => {
    const md = await ctxFor('md@demo.test')
    const s = await newStaff()
    await staffPhotos.saveStaffPhoto(md, s.id, await photo(), { x: 100, y: 0, width: 600, height: 600 })
    const [p] = await adminSql()`select display_key, thumb_key from staff_photos where user_id = ${s.id} and is_current`
    const thumb = await sharp(await (await getStorage()).get(p.thumb_key)).metadata()
    const disp = await sharp(await (await getStorage()).get(p.display_key)).metadata()
    expect([thumb.width, thumb.height]).toEqual([256, 256])
    expect(disp.width).toBe(disp.height)
    expect(disp.exif).toBeUndefined()
    // a colleague in the same company sees it; staff of the other company do not
    expect(await staffPhotos.staffPhotoBytes(await ctxFor('edx.counsellor@demo.test'), s.id, 'thumb')).not.toBeNull()
    expect(await staffPhotos.staffPhotoBytes(await ctxFor('grd.counsellor@demo.test'), s.id, 'thumb')).toBeNull()
    // a colleague without authority cannot change it; the person can
    await expectServiceError(staffPhotos.saveStaffPhoto(await ctxFor('edx.counsellor@demo.test'), s.id, await photo(), null))
    await staffPhotos.removeStaffPhoto(md, s.id)
    expect(await staffPhotos.staffPhotoBytes(md, s.id, 'thumb')).toBeNull()
    const own = await ctxFor('edx.counsellor@demo.test')
    await staffPhotos.saveStaffPhoto(own, own.userId, await photo(), null)
    expect((await staffPhotos.staffPhotoVersions(md, [own.userId]))[own.userId]).toBeGreaterThan(0)
    await expectDbError(adminSql()`delete from staff_photos where user_id = ${own.userId}`, '42501')
  })

  it('reporting manager: same company, no loops, only administrators', async () => {
    const md = await ctxFor('md@demo.test')
    const a = await newStaff(); const b = await newStaff()
    await admin.setReportingManager(md, b.id, a.id)
    await expectServiceError(admin.setReportingManager(md, a.id, b.id), 'invalid') // loop
    const grd = await newStaff(GRD)
    await expectServiceError(admin.setReportingManager(md, b.id, grd.id), 'invalid') // other company only
    await expectServiceError(admin.setReportingManager(await ctxFor('edx.counsellor@demo.test'), b.id, null))
    expect((await admin.getStaffMember(md, a.id))!.reports.map((r) => r.id)).toContain(b.id)
  })
})

describe('dynamic roles', () => {
  it('role status and structure; inactive roles cannot be assigned; protected and own roles cannot be changed', async () => {
    const md = await ctxFor('md@demo.test')
    const name = `Team Leader ${rand()}`
    await admin.createRole(md, EDX, name, 'Leads a counselling team')
    const [r] = await adminSql()`select id, is_active from roles where org_id = ${EDX} and name = ${name}`
    expect(r.is_active).toBe(true)
    expect((await adminSql()`select count(*)::int as n from role_permissions where role_id = ${r.id}`)[0].n).toBe(0) // least privilege
    const manager = await roleId(EDX, 'manager')
    await admin.setRoleStructure(md, r.id, true, manager)
    await expectServiceError(admin.setRoleStructure(md, manager, true, r.id), 'invalid') // loop
    await expectServiceError(admin.setRoleStructure(md, r.id, true, await roleId(GRD, 'manager')), 'invalid') // other company
    await admin.setRoleStructure(md, r.id, false, manager)
    await expectServiceError(admin.createStaff(md, { email: `inactive.${rand()}@example.test`, fullName: 'Inactive Role', orgId: EDX, roleId: r.id }), 'invalid')
    await admin.setRoleStructure(md, r.id, true, manager)
    await admin.createStaff(md, { email: `tl.${rand()}@example.test`, fullName: 'Team Leader Person', orgId: EDX, roleId: r.id })
    await expectServiceError(admin.setRoleStructure(md, r.id, false, manager), 'invalid') // people hold it
    await expectServiceError(admin.setRoleStructure(md, await roleId(EDX, 'md'), true, null), 'forbidden') // protected MD role
    await expectServiceError(admin.setRoleStructure(await ctxFor('edx.counsellor@demo.test'), r.id, true, null), 'forbidden')
    // existing escalation rule still holds: an administrator cannot assign a role with permissions they lack
    const sysadmin = await ctxFor('admin@demo.test')
    await expectServiceError(admin.createStaff(sysadmin, { email: `esc.${rand()}@example.test`, fullName: 'Escalation Test', orgId: EDX, roleId: await roleId(EDX, 'finance') }))
  })
})
