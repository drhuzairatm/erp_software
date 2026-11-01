/** Phase 4: shared AND/OR conditions for rules, rule tester and condition preview. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/server/db'
import { ServiceError } from '@/server/errors'
import { parseConditions, trace } from '@/lib/conditions'
import * as att from '@/server/services/attestation'
import * as documents from '@/server/services/documents'
import * as pp from '@/server/services/passport'
import * as rules from '@/server/services/rules'
import * as students from '@/server/services/students'
import * as unis from '@/server/services/universities'
import * as vr from '@/server/services/verification-rules'
import { adminSql, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const country = async (code: string) => (await adminSql()`select id from countries where code = ${code}`)[0].id as string
beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}

/** Student with a verified passport of the given nationality. */
async function studentWithNationality(nat: string, extra: Record<string, unknown> = {}) {
  const mgr = await ctxFor('edx.manager@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Rule Student', phone: `+91 90093 ${rand()}`, ...extra })
  if (!r.ok) throw new Error('duplicate')
  const id = await pp.recordPassport(mgr, r.id, { kind: 'initial', passportNumber: `RN${rand()}`, expiryDate: '2036-01-01',
    nationalityCountryId: await country(nat), issuingCountryId: await country(nat) })
  await pp.verifyPassport(mgr, id, 'verified')
  return { mgr, id: r.id }
}

describe('condition language', () => {
  it('ALL / ANY / nested groups, unknown facts and numbers behave the same in the database and the explanation', async () => {
    const facts = { nationality: 'A', destination_country: 'B', age: 18 }
    const cases: [unknown, boolean][] = [
      [null, true],
      [{ all: [{ field: 'nationality', op: 'in', values: ['A'] }, { field: 'destination_country', op: 'in', values: ['B'] }] }, true],
      [{ all: [{ field: 'nationality', op: 'in', values: ['A'] }, { field: 'destination_country', op: 'in', values: ['X'] }] }, false],
      [{ any: [{ field: 'nationality', op: 'in', values: ['X'] }, { field: 'destination_country', op: 'in', values: ['B'] }] }, true],
      [{ all: [{ field: 'age', op: 'gte', value: 17 }, { any: [{ field: 'nationality', op: 'not_in', values: ['A'] }, { field: 'age', op: 'lte', value: 18 }] }] }, true],
      [{ all: [{ field: 'residence_country', op: 'not_in', values: ['A'] }] }, false], // unknown fact never matches
      [{ all: [{ field: 'residence_country', op: 'is_not_set' }] }, true],
      [{ all: [{ field: 'nationality', op: 'is_set' }] }, true],
    ]
    for (const [c, expected] of cases) {
      const parsed = parseConditions(c)
      const [{ ok }] = await adminSql()`select app.condition_eval(${parsed ? adminSql().json(parsed as never) : null}, ${adminSql().json(facts)}) as ok`
      expect(ok, JSON.stringify(c)).toBe(expected)
      expect(trace(parsed, facts, {}).result, JSON.stringify(c)).toBe(expected)
    }
  })

  it('invalid conditions are refused (input and database)', async () => {
    expect(() => parseConditions({ all: [{ field: 'shoe_size', op: 'in', values: ['x'] }] })).toThrow(/Unknown condition field/)
    expect(() => parseConditions({ all: [{ field: 'nationality', op: 'in', values: [] }] })).toThrow(/at least one/)
    expect(() => parseConditions({ all: [{ field: 'age', op: 'in', values: ['1'] }] })).toThrow()
    await expectDbError(adminSql()`update passport_validity_rules set conditions = '{"all":[{"field":"x","op":"in","values":["a"]}]}' where false or true`, '23514')
  })
})

describe('conditions on rules', () => {
  it('Bonafide/verification rule by NATIONALITY: applies only to matching students', async () => {
    const admin = await ctxFor('admin@demo.test'); const md = await ctxFor('md@demo.test')
    const india = await country('IN')
    const ruleId = await vr.saveRuleDraft(admin, null, { name: `Bonafide – Indian nationals ${rand()}`, documentTypeId: (await adminSql()`select id from document_types where key = 'bonafide_certificate'`)[0].id,
      conditions: JSON.stringify({ all: [{ field: 'nationality', op: 'in', values: [india] }] }) })
    await vr.addRequirement(admin, ruleId, { kind: 'manual_check', text: 'Eligibility statement present' })
    await vr.approveRule(md, ruleId)
    const indian = await studentWithNationality('IN')
    const other = await studentWithNationality('AE')
    const bonafide = async (sid: string) => (await documents.getChecklist(indian.mgr, sid)).items.find((i) => i.type_key === 'bonafide_certificate')
    const docIn = await bonafide(indian.id); const docOther = await bonafide(other.id)
    if (!docIn || !docOther) return // workflow without a Bonafide item
    const applies = async (doc: string) => (await adminSql()`select ${ruleId}::uuid in (select app.applicable_rules(${doc})) as ok`)[0].ok
    expect(await applies(docIn.id)).toBe(true)
    expect(await applies(docOther.id)).toBe(false)
    // a new version keeps the conditions
    const v2 = await vr.newRuleVersion(admin, ruleId)
    expect((await adminSql()`select conditions from verification_rules where id = ${v2} and status = 'draft'`)[0].conditions).toMatchObject({ all: [{ field: 'nationality' }] })
  })

  it('passport validity rule with a condition blocks only the matching students', async () => {
    const admin = await ctxFor('admin@demo.test')
    const uae = await country('AE')
    const name = `Phase 4 rule ${rand()}`
    await pp.addValidityRule(admin, { name, minMonths: '120', stageKey: 'registration', enforcement: 'block',
      conditions: JSON.stringify({ all: [{ field: 'nationality', op: 'in', values: [uae] }] }) })
    try {
      const a = await studentWithNationality('AE'); const b = await studentWithNationality('IN')
      const issues = async (sid: string) => (await adminSql()`select message from app.stage_requirement_issues(${sid}, 'registration') where kind = 'passport'`).map((r) => r.message)
      expect((await issues(a.id)).some((m) => m.startsWith(name))).toBe(true)
      expect((await issues(b.id)).some((m) => m.startsWith(name))).toBe(false)
    } finally {
      await adminSql()`update passport_validity_rules set is_active = false where name = ${name}`
    }
  })

  it('university document requirement only for students who match (checklist)', async () => {
    const admin = await ctxFor('md@demo.test')
    const [u] = await adminSql()`select id from universities where is_active order by name limit 1`
    const [t] = await adminSql()`select id from document_types where key = 'medical_certificate' or key like 'medical%' order by key limit 1`
    if (!t) return
    await adminSql()`delete from university_document_requirements where university_id = ${u.id} and document_type_id = ${t.id} and conditions is not null`
    const exists = (await adminSql()`select 1 from university_document_requirements where university_id = ${u.id} and document_type_id = ${t.id}`).length
    if (exists) return // already required for everyone at this university
    await unis.addUniversityPart(admin, u.id, 'requirement', { documentTypeId: t.id,
      conditions: JSON.stringify({ all: [{ field: 'nationality', op: 'in', values: [await country('AE')] }] }) })
    const a = await studentWithNationality('AE', { preferredUniversityId: u.id })
    const b = await studentWithNationality('IN', { preferredUniversityId: u.id })
    const has = async (sid: string) => (await adminSql()`select 1 from student_documents where student_id = ${sid} and document_type_id = ${t.id} and requirement_source = 'university'`).length > 0
    expect(await has(a.id)).toBe(true)
    expect(await has(b.id)).toBe(false)
  })

  it('attestation route versions copy their conditions', async () => {
    const admin = await ctxFor('admin@demo.test')
    const id = await att.saveRouteDraft(admin, null, { name: `Phase 4 route ${rand()}`, destinationCountryId: await country('BG'), routeType: 'apostille',
      conditions: JSON.stringify({ any: [{ field: 'nationality', op: 'in', values: [await country('IN')] }, { field: 'age', op: 'gte', value: 18 }] }) })
    const [r] = await adminSql()`select conditions from attestation_routes where id = ${id}`
    expect(r.conditions).toMatchObject({ any: [{ field: 'nationality' }, { field: 'age', op: 'gte', value: 18 }] })
  })
})

describe('rule tester and preview', () => {
  it('explains which rules apply to a student; preview counts matching students; only rule managers', async () => {
    const s = await studentWithNationality('IN')
    const [{ student_code }] = await adminSql()`select student_code from students where id = ${s.id}`
    const admin = await ctxFor('md@demo.test')
    const r = (await rules.testStudent(admin, student_code))!
    expect(r.facts.find((f) => f.key === 'nationality')).toBeTruthy()
    expect(r.results.some((x) => x.kind === 'Passport validity')).toBe(true)
    const p = await rules.previewCondition(admin, JSON.stringify({ all: [{ field: 'nationality', op: 'in', values: [await country('IN')] }] }))
    expect(p.matching).toBeGreaterThan(0)
    expect(p.description).toMatch(/Nationality \(passport\) is one of India/)
    await expectServiceError(rules.testStudent(await ctxFor('edx.counsellor@demo.test'), student_code))
  })
})
