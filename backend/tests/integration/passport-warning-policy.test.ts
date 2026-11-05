/**
 * MD decision (4 Nov 2026): an expired, short-validity or missing passport never blocks Registration, and only warns at
 * University Application, unless a verified university-specific rule applies. Fictional students only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as pp from '@/services/passport'
import { commitImport, previewImport } from '@/services/student-import'
import * as students from '@/services/students'
import { adminSql, ctxFor, delegateToSystemAdmin, orgId } from '../support/helpers'

let EDX: string, varna: string, pleven: string, bg: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const dayFromNow = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const SCENARIOS: [string, Record<string, string>][] = [
  ['expired', { passportNumber: 'expiry', passportExpiry: dayFromNow(-30) }],
  ['valid for less than 12 months', { passportNumber: 'expiry', passportExpiry: dayFromNow(200) }],
  ['with no expiry recorded', {}],
]
beforeAll(async () => {
  await delegateToSystemAdmin(['passport.rules.manage'])
  EDX = await orgId('EDX')
  bg = (await adminSql()`select id from countries where code = 'BG'`)[0].id
  ;[{ id: varna }, { id: pleven }] = await adminSql()`select id from universities where name in ('Medical University – Varna', 'Medical University – Pleven') order by name desc`
})
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectInvalid(p: Promise<unknown>) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); expect((e as ServiceError).kind).toBe('invalid'); return e as ServiceError }
  throw new Error('expected a refusal')
}
async function newStudent(extra: Record<string, unknown> = {}) {
  const mgr = await ctxFor('edx.manager@demo.test')
  const passport = extra.passportNumber === 'expiry' ? { passportNumber: `PW${rand()}` } : {}
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Passport Policy Student', phone: `+91 90095 ${rand()}`, phone2: `+91 90096 ${rand()}`,
    email: `policy.${rand()}${rand()}@example.test`, ...extra, ...passport })
  if (!r.ok) throw new Error('duplicate')
  return { mgr, id: r.id }
}
const stageOf = async (id: string) => (await adminSql()`select current_stage_key as s from students where id = ${id}`)[0].s
async function expectWarnOnly(mgr: Awaited<ReturnType<typeof ctxFor>>, id: string) {
  expect((await students.changeStage(mgr, id, { toStage: 'registration', acknowledge: 'yes' })).ok).toBe(true)
  expect(await stageOf(id)).toBe('registration')
  const first = await students.changeStage(mgr, id, { toStage: 'university_application' })
  expect(first.ok).toBe(false) // shown to staff first
  if (!first.ok) expect(first.warnings.join(' ')).toMatch(/at least 12 months/)
  expect(await stageOf(id)).toBe('registration')
  expect(await students.changeStage(mgr, id, { toStage: 'university_application', acknowledge: 'yes' })).toEqual({ ok: true })
  expect(await stageOf(id)).toBe('university_application')
}

describe('default behaviour: warning only', () => {
  it.each(SCENARIOS)('a passport %s: registered, then a warning at University Application, and it continues once acknowledged', async (_label, passport) => {
    const { mgr, id } = await newStudent(passport)
    await expectWarnOnly(mgr, id)
  })

  it('a passport valid for more than 12 months shows no passport warning', async () => {
    const { mgr, id } = await newStudent({ passportNumber: 'expiry', passportExpiry: dayFromNow(800) })
    await students.changeStage(mgr, id, { toStage: 'registration', acknowledge: 'yes' })
    const r = await students.changeStage(mgr, id, { toStage: 'university_application' })
    if (!r.ok) expect(r.warnings.join(' ')).not.toMatch(/at least 12 months/)
  })

  it('the missing-expiry warning says so', async () => {
    const { id } = await newStudent()
    const issues = await adminSql()`select enforcement, message from app.stage_requirement_issues(${id}, 'university_application') where kind = 'passport'`
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((i) => i.enforcement === 'warn')).toBe(true)
    expect(issues.map((i) => i.message).join(' ')).toMatch(/no passport expiry recorded/)
  })
})

describe('import', () => {
  it('imports expired, short-validity and missing passports as ready rows; each then only warns at University Application', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const a = rand(), b = rand(), c = rand()
    const dmy = (iso: string) => iso.split('-').reverse().join('/')
    const csv = ['Name,Phone,Secondary phone,Email,Passport number,Passport expiry',
      `Import Expired,+91 90091 ${a},+91 90092 ${a},imp.${a}@example.test,PX${a},${dmy(dayFromNow(-30))}`,
      `Import Short,+91 90091 ${b},+91 90092 ${b},imp.${b}@example.test,PX${b},${dmy(dayFromNow(200))}`,
      `Import Missing,+91 90091 ${c},+91 90092 ${c},imp.${c}@example.test,,`].join('\n')
    const preview = await previewImport(mgr, EDX, csv)
    expect(preview.rows.map((r) => r.status)).toEqual(['ready', 'ready', 'ready'])
    const r = await commitImport(mgr, EDX, csv, { includeDuplicates: false, fileName: 'passport-policy.csv' })
    expect(r.imported).toHaveLength(3)
    expect(r.skipped).toEqual([])
    const stored = await adminSql()`select passport_expiry from students where id = any(${r.imported.map((i) => i.id)}::uuid[])`
    expect(stored.filter((s) => s.passport_expiry === null)).toHaveLength(1)
    for (const i of r.imported) await expectWarnOnly(mgr, i.id)
  })
})

describe('a verified university-specific rule', () => {
  it('blocks only students applying to that university, never Registration', async () => {
    const admin = await ctxFor('admin@demo.test')
    const name = `Fictional Varna rule ${rand()}`
    await pp.addValidityRule(admin, { name, universityId: varna, stageKey: 'university_application', minMonths: '18', enforcement: 'block', notes: 'Fictional official source (test)' })
    try {
      const short = { passportNumber: 'expiry', passportExpiry: dayFromNow(200) }
      const a = await newStudent({ ...short, destinationCountryId: bg, preferredUniversityId: varna })
      expect((await students.changeStage(a.mgr, a.id, { toStage: 'registration', acknowledge: 'yes' })).ok).toBe(true)
      const e = await expectInvalid(students.changeStage(a.mgr, a.id, { toStage: 'university_application', acknowledge: 'yes' }))
      expect(e.message).toMatch(/at least 18 months/)
      // the same function drives the database trigger on stage changes
      const issues = await adminSql()`select enforcement from app.stage_requirement_issues(${a.id}, 'university_application') where kind = 'passport'`
      expect(issues.map((i) => i.enforcement)).toContain('block')
      expect(await stageOf(a.id)).toBe('registration')

      const b = await newStudent({ ...short, destinationCountryId: bg, preferredUniversityId: pleven })
      await expectWarnOnly(b.mgr, b.id)
    } finally {
      await adminSql()`update passport_validity_rules set is_active = false where name = ${name}`
    }
  })
})

describe('a rule cannot be added that breaks the policy', () => {
  const block = { minMonths: '12', stageKey: 'university_application', enforcement: 'block', notes: 'Fictional source' }
  const count = async () => (await adminSql()`select count(*)::int as n from passport_validity_rules`)[0].n as number

  it.each([
    ['for all students', () => ({ ...block, name: 'T global block' }), /specific university/],
    ['for a whole destination', () => ({ ...block, name: 'T country block', destinationCountryId: bg }), /specific university/],
    ['without its source', () => ({ ...block, name: 'T no source', universityId: varna, notes: ' ' }), /official source/],
    ['at Registration', () => ({ ...block, name: 'T registration', universityId: varna, stageKey: 'registration' }), /Registration must always remain allowed/],
    ['before Registration', () => ({ ...block, name: 'T lead', universityId: varna, stageKey: 'lead' }), /Registration must always remain allowed/],
  ])('blocking %s is refused', async (_label, values, message) => {
    const admin = await ctxFor('admin@demo.test')
    const before = await count()
    expect((await expectInvalid(pp.addValidityRule(admin, values()))).message).toMatch(message)
    expect(await count()).toBe(before)
  })

  it('a warning rule at any scope is still allowed', async () => {
    const admin = await ctxFor('admin@demo.test')
    const name = `Fictional warning ${rand()}`
    await pp.addValidityRule(admin, { name, minMonths: '6', stageKey: 'registration', enforcement: 'warn' })
    await adminSql()`update passport_validity_rules set is_active = false where name = ${name}`
  })
})
