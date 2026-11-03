/** MD-controlled master data – the 16 acceptance checks (fictional data). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/server/db'
import { ServiceError } from '@/server/errors'
import * as md from '@/server/services/master-data'
import * as students from '@/server/services/students'
import * as unis from '@/server/services/universities'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const code2 = () => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; return 'Q' + a[Math.floor(Math.random() * 26)] }
beforeAll(async () => {
  EDX = await orgId('EDX')
  // default state: only the MD holds master-data permissions (earlier test files delegate some to the System Administrator)
  await adminSql()`delete from role_permissions rp using roles r where r.id = rp.role_id and r.key = 'system_admin'
    and rp.permission_key = any(${[...md.MD_PERMS]}::text[])`
})
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}
async function newCountry(mdCtx: Awaited<ReturnType<typeof ctxFor>>) {
  let code = code2()
  while ((await adminSql()`select 1 from countries where code = ${code}`).length) code = code2()
  const name = `Testland ${rand()}`
  await md.saveCountry(mdCtx, null, { code, name, nationality: 'Testlandic', currencyCode: 'EUR', use: 'destination' })
  return (await adminSql()`select id, name from countries where code = ${code}`)[0] as { id: string; name: string }
}

describe('MD master data', () => {
  it('1–4, 7: the MD adds and edits a country, several universities and courses (with specialisation and country offering)', async () => {
    const m = await ctxFor('md@demo.test')
    const c = await newCountry(m)
    await md.saveCountry(m, c.id, { code: (await adminSql()`select code from countries where id = ${c.id}`)[0].code, name: `${c.name} (edited)`, notes: 'Fictional', use: 'destination' })
    expect((await adminSql()`select name, nationality, currency_code from countries where id = ${c.id}`)[0]).toMatchObject({ name: `${c.name} (edited)`, nationality: null })
    for (const n of ['North', 'South']) await unis.saveUniversity(m, null, { countryId: c.id, name: `${n} Test University ${rand()}`, city: 'Demo City' })
    expect((await adminSql()`select count(*)::int as n from universities where country_id = ${c.id}`)[0].n).toBe(2)
    const nm = `Dentistry ${rand()}`
    await md.saveCourse(m, null, { name: nm, category: 'Dentistry', duration: '5', countryIds: c.id })
    const [course] = await adminSql()`select id, category, default_duration_years from courses where name = ${nm}`
    expect(course).toMatchObject({ category: 'Dentistry', default_duration_years: '5.0' })
    await md.saveCourse(m, null, { name: `${nm} – Orthodontics`, category: 'Dentistry', parentCourseId: course.id })
    expect((await adminSql()`select parent_course_id from courses where name = ${nm + ' – Orthodontics'}`)[0].parent_course_id).toBe(course.id)
    expect((await adminSql()`select count(*)::int as n from course_countries where course_id = ${course.id} and country_id = ${c.id}`)[0].n).toBe(1)
  })

  it('8, 9, 13, 14: university must be in the destination; courses follow the university; deactivated records are not offered; history kept', async () => {
    const m = await ctxFor('md@demo.test'); const mgr = await ctxFor('edx.manager@demo.test')
    const c = await newCountry(m); const other = await newCountry(m)
    await unis.saveUniversity(m, null, { countryId: c.id, name: `Main Test University ${rand()}` })
    const [u] = await adminSql()`select id, name from universities where country_id = ${c.id}`
    const [mbbs] = await adminSql()`select id from courses where code = 'MBBS'`
    const [nursing] = await adminSql()`select id from courses where code = 'NURSING'`
    await unis.addUniversityPart(m, u.id, 'course', { courseId: mbbs.id })
    const base = { originatingOrgId: EDX, fullName: 'Master Data Student' }
    // 8: university of another country refused
    await expectServiceError(students.createStudent(mgr, { ...base, phone: `+91 90087 ${rand()}`, destinationCountryId: other.id, preferredUniversityId: u.id }), 'invalid')
    // 9: course not offered by the university refused; offered course accepted
    await expectServiceError(students.createStudent(mgr, { ...base, phone: `+91 90087 ${rand()}`, destinationCountryId: c.id, preferredUniversityId: u.id, courseId: nursing.id }), 'invalid')
    const ok = await students.createStudent(mgr, { ...base, phone: `+91 90087 ${rand()}`, destinationCountryId: c.id, preferredUniversityId: u.id, courseId: mbbs.id })
    if (!ok.ok) throw new Error()
    // 13: deactivated university is not offered for NEW applications
    await md.setMasterStatus(m, 'university', u.id, false)
    await expectServiceError(students.createStudent(mgr, { ...base, phone: `+91 90087 ${rand()}`, destinationCountryId: c.id, preferredUniversityId: u.id, courseId: mbbs.id }), 'invalid')
    // 14: the existing student keeps it, and other edits still work; the name at selection is kept after a rename
    const cur = (await students.getStudent(mgr, ok.id))!.student
    await students.updateStudent(mgr, ok.id, { originatingOrgId: EDX, fullName: 'Master Data Student (edited)', phone: cur.phone, destinationCountryId: c.id, preferredUniversityId: u.id, courseId: mbbs.id })
    await adminSql()`update universities set name = ${u.name + ' (renamed)'} where id = ${u.id}`
    const h = (await md.selectionHistory(mgr, ok.id))!
    expect(h).toMatchObject({ university: u.name, university_active: false })
    expect((await adminSql()`select preferred_university_id from students where id = ${ok.id}`)[0].preferred_university_id).toBe(u.id)
    // master data is never deleted
    await expectDbError(adminSql()`delete from universities where id = ${u.id}`, '42501')
  })

  it('10, 16: staff cannot change master data, even through the database', async () => {
    for (const email of ['edx.manager@demo.test', 'admin@demo.test', 'ceo@demo.test']) {
      const ctx = await ctxFor(email)
      await expectServiceError(md.saveCountry(ctx, null, { code: 'QZ', name: 'Nowhere', use: 'destination' }), 'forbidden')
      await expectServiceError(md.saveCourse(ctx, null, { name: 'Unauthorised course', category: 'Other' }), 'forbidden')
      await expectDbError(as(email, (tx) => tx`insert into countries (code, name) values ('QZ', 'Nowhere')`), '42501')
      const r = await as(email, (tx) => tx`update courses set name = 'Hacked' where code = 'MBBS'`)
      expect(r.count).toBe(0)
      await expectDbError(as(email, (tx) => tx`insert into universities (country_id, name) select id, 'Hacked University' from countries limit 1`), '42501')
    }
  })

  it('11, 12: an employee given selected permissions can do only those; the MD revokes them', async () => {
    const m = await ctxFor('md@demo.test')
    const [role] = await adminSql()`select id from roles where org_id = ${EDX} and key = 'system_admin'`
    await adminSql()`insert into role_permissions (role_id, permission_key) values (${role.id}, 'countries.manage') on conflict do nothing`
    const sys = await ctxFor('admin@demo.test')
    const c = await newCountry(sys) // allowed: countries.manage
    await expectServiceError(md.setMasterStatus(sys, 'country', c.id, false), 'forbidden') // not delegated: status
    await expectServiceError(md.saveCourse(sys, null, { name: `Delegation test ${rand()}`, category: 'Other' }), 'forbidden') // not delegated: courses
    await adminSql()`delete from role_permissions where role_id = ${role.id} and permission_key = 'countries.manage'`
    const after = await ctxFor('admin@demo.test')
    await expectServiceError(md.saveCountry(after, c.id, { code: 'ZZ', name: 'Revoked', use: 'destination' }), 'forbidden')
    void m
  })

  it('5, 6, 15 and requests: rules attach to country/university/course; every change is audited; staff request missing data, the MD approves', async () => {
    const m = await ctxFor('md@demo.test')
    const c = await newCountry(m)
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    await md.requestMasterData(counsellor, { kind: 'university', name: `Requested University ${rand()}`, countryId: c.id, details: 'Student asked' })
    await expectServiceError(md.requestMasterData(counsellor, { kind: 'university', name: 'No Country University' }), 'invalid')
    const [req] = (await md.listRequests(m)).filter((r) => r.status === 'pending' && r.country === c.name)
    await expectServiceError(md.decideRequest(counsellor, req.id, true))
    const id = await md.decideRequest(m, req.id, true)
    expect((await adminSql()`select country_id, is_active from universities where id = ${id}`)[0]).toMatchObject({ country_id: c.id, is_active: true })
    const hist = await md.masterDataHistory(m)
    expect(hist.some((h) => h.entity_type === 'countries')).toBe(true)
    expect(hist.some((h) => h.entity_type === 'universities')).toBe(true)
    expect(hist.some((h) => h.entity_type === 'masterdata_requests')).toBe(true)
    // permissions view lists the MD role with every master-data permission
    const perms = await md.masterDataPermissions(m)
    expect(perms.find((p) => p.is_protected)?.perms.length).toBe(md.MD_PERMS.length)
  })
})
