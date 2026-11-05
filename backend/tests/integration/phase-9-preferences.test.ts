/** Phase 9: preferences, academic years, advisory rules by intake, and country document rules. Fictional data. Nothing here blocks registration. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ServiceError } from '@/lib/errors'
import * as pref from '@/services/preferences'
import * as students from '@/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string; let BG: string; let RU: string; let BG_UNI: string; let OTHER_UNI: string
const MGR = 'edx.manager@demo.test'; const MD = 'md@demo.test'; const SA = 'admin@demo.test'; const G = 'grd.manager@demo.test'; const C = 'edx.counsellor@demo.test'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
async function refuses(p: Promise<unknown>, text?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (text) expect(`${(e as ServiceError).kind} ${(e as ServiceError).message}`).toContain(text); return }
  throw new Error('expected a refusal')
}
async function student() {
  const s = await students.createStudent(await ctxFor(MGR), { originatingOrgId: EDX, fullName: `Fictional Pref ${rand()}`, phone: `+91 90099 ${rand().slice(0, 5)}` })
  return typeof s === 'string' ? s : (s as { id: string }).id
}
const year = async () => { const code = `${2100 + Math.floor(Math.random() * 7000)}-01`; await pref.saveAcademicYear(await ctxFor(MD), null, code, null, true); return (await adminSql()`select id, code from academic_years where code = ${code}`)[0] }

beforeAll(async () => {
  EDX = await orgId('EDX'); const sql = adminSql()
  BG = (await sql`select id from countries where code = 'BG'`)[0].id
  RU = (await sql`select id from countries where id <> ${BG} and is_active and is_destination limit 1`)[0].id
  const [bu] = await sql`select id from universities where country_id = ${BG} and is_active limit 1`
  BG_UNI = bu?.id ?? (await sql`insert into universities (country_id, name) values (${BG}, ${'Fictional Bulgarian University ' + rand()}) returning id`)[0].id
  const [ou] = await sql`select id from universities where country_id <> ${BG} and is_active limit 1`
  OTHER_UNI = ou.id
})
afterAll(async () => { await adminSql().end() })

describe('preferences', () => {
  it('secondary and tertiary are saved, validated and recorded; the primary stays on the student record', async () => {
    const id = await student(); const m = await ctxFor(MGR)
    await refuses(pref.savePreference(m, id, 2, {}), 'active country')
    await refuses(pref.savePreference(m, id, 2, { countryId: BG, universityId: OTHER_UNI }), 'not in the chosen country')
    await expectDbError(as(MGR, (tx) => tx`select app.student_preference_save(${id}, 1, ${tx.json({ country_id: BG })})`), '23514')
    await pref.savePreference(m, id, 2, { countryId: BG, universityId: BG_UNI })
    await refuses(pref.savePreference(m, id, 3, { countryId: BG, universityId: BG_UNI }), 'already listed')
    await pref.savePreference(m, id, 3, { countryId: RU })
    const d = (await pref.studentPreferences(m, id))!
    expect(d.others.map((o) => [o.rank, o.country_id])).toEqual([[2, BG], [3, RU]])
    await adminSql()`update students set destination_country_id = ${RU} where id = ${id}`
    await pref.clearPreference(m, id, 3)
    await refuses(pref.savePreference(m, id, 3, { countryId: RU }), 'same as the primary')
    const h = await adminSql()`select rank, action, country from student_preference_history where student_id = ${id} order by changed_at, id`
    expect(h.map((x) => x.action)).toEqual(['saved', 'saved', 'cleared'])
    expect(h[0].country).toBe('Bulgaria')
    expect(await adminSql()`select 1 from students where id = ${id} and archived_at is null`).toHaveLength(1)
  })

  it('follows student access: another company sees nothing and cannot change it, and direct writes are refused', async () => {
    const id = await student(); await pref.savePreference(await ctxFor(MGR), id, 2, { countryId: BG })
    expect(await pref.studentPreferences(await ctxFor(G), id)).toBeNull()
    await refuses(pref.savePreference(await ctxFor(G), id, 3, { countryId: BG }), 'forbidden')
    await expectDbError(as(G, (tx) => tx`select app.student_preference_requirements(${id}, 2)`), 'P0002')
    expect(await as(G, (tx) => tx`select id from student_preferences where student_id = ${id}`)).toHaveLength(0)
    await expectDbError(as(MGR, (tx) => tx`update student_preferences set rank = 3 where student_id = ${id}`), '42501')
    await expectDbError(as(MGR, (tx) => tx`insert into country_document_rules (country_id, document_type_id) select ${BG}, id from document_types limit 1`), '42501')
    const open = await adminSql()`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('save_academic_year', 'student_preference_save', 'student_preference_clear', 'save_country_document_rule', 'verify_country_document_rule', 'set_country_document_rule_active', 'student_preference_requirements', 'student_advisories_for', 'student_advisories', 'save_advisory_notice') and has_function_privilege('public', p.oid, 'execute')`
    expect(open).toEqual([])
  })
})

describe('requirements shown for a preference', () => {
  it('Bulgaria shows subject-wise marks, Bonafide and the PCC check for a secondary choice; registration is not blocked', async () => {
    const id = await student(); const m = await ctxFor(MGR)
    await pref.savePreference(m, id, 2, { countryId: BG, universityId: BG_UNI })
    const r = (await pref.studentPreferences(m, id))!.others[0].requirements!
    const bulgarian = r.advisories.find((a) => a.title.includes('BULGARIA'))!
    expect(bulgarian.items!.map((i) => [i.subject, i.min_percentage])).toEqual(expect.arrayContaining([['Chemistry', 60], ['Biology', 60], ['Physics', 60], ['English', 60]]))
    expect(bulgarian.items!.every((i) => i.result === 'missing')).toBe(true)
    expect(r.country_documents.map((d) => d.document)).toEqual(expect.arrayContaining(['Bonafide Certificate', 'Police Clearance Certificate (PCC)']))
    const pcc = r.country_documents.find((d) => d.document.startsWith('Police'))!
    expect(pcc.match).toBe('unknown')
    expect(pcc.guidance).toBeNull() // no invented timing
    // the record itself has no destination: nothing to show for the primary
    expect((await pref.studentPreferences(m, id))!.primaryRequirements).toBeNull()
  })

  it('PCC: a different issuing country warns, the same country matches', async () => {
    const id = await student(); const m = await ctxFor(MGR); const sql = adminSql()
    await pref.savePreference(m, id, 2, { countryId: BG })
    const [doc] = await sql`select id from document_types where key = 'police_clearance'`
    const [sd] = await sql`insert into student_documents (student_id, document_type_id, is_required, created_by, issuing_country_id) values (${id}, ${doc.id}, true, ${m.userId}, ${RU}) returning id`
    const pcc = async () => (await pref.studentPreferences(m, id))!.others[0].requirements!.country_documents.find((d) => d.document.startsWith('Police'))!.match
    expect(await pcc()).toBe('unknown')
    await sql`update students set visa_application_country_id = ${BG} where id = ${id}`
    expect(await pcc()).toBe('mismatch')
    await sql`update student_documents set issuing_country_id = ${BG} where id = ${sd.id}`
    expect(await pcc()).toBe('match')
  })

  it('a country with no rule invents nothing', async () => {
    const id = await student(); const m = await ctxFor(MGR)
    const sql = adminSql()
    const [c] = await sql`select c.id from countries c where c.is_active and c.is_destination and c.code <> 'BG' and not exists (select 1 from country_document_rules r where r.country_id = c.id) and not exists (select 1 from advisory_notices a where a.destination_country_id = c.id and a.status = 'active') limit 1`
    await pref.savePreference(m, id, 2, { countryId: c.id })
    const r = (await pref.studentPreferences(m, id))!.others[0].requirements!
    expect(r.country_documents).toEqual([])
    expect(r.advisories).toEqual([])
  })

  it('an advisory notice can be limited to one intake', async () => {
    const id = await student(); const m = await ctxFor(MGR); const sql = adminSql()
    const [i1] = await sql`insert into university_intakes (university_id, name) values (${BG_UNI}, ${'Fictional intake A ' + rand()}) returning id`.catch(() => sql`select id from university_intakes where university_id = ${BG_UNI} limit 1`)
    const [i2] = await sql`insert into university_intakes (university_id, name) values (${BG_UNI}, ${'Fictional intake B ' + rand()}) returning id`
    const title = `Fictional intake notice ${rand()}`
    await as(MD, (tx) => tx`select app.save_advisory_notice(null, ${tx.json({ category: 'general', destination_country_id: BG, university_id: BG_UNI, intake_id: i1.id, title, message: 'Fictional', requires_acknowledgement: false })}, '[]'::jsonb, null)`)
    const has = async () => (await pref.studentPreferences(m, id))!.others[0].requirements!.advisories.some((a) => a.title === title)
    await pref.savePreference(m, id, 2, { countryId: BG, universityId: BG_UNI, intakeId: i2.id })
    expect(await has()).toBe(false)
    await pref.savePreference(m, id, 2, { countryId: BG, universityId: BG_UNI, intakeId: i1.id })
    expect(await has()).toBe(true)
  })
})

describe('country document rules', () => {
  it('an unverified rule cannot be activated; only the MD verifies; editing by a non-verifier resets it', async () => {
    const sql = adminSql(); const md = await ctxFor(MD); const [doc] = await sql`select id from document_types where key = 'photo_white_bg'`
    const [c] = await sql`select id from countries where is_active and code <> 'BG' limit 1`
    await sql`delete from country_document_rules where country_id = ${c.id} and document_type_id = ${doc.id}`
    await sql`insert into role_permissions (role_id, permission_key) select id, 'requirements.manage' from roles where key = 'manager' on conflict do nothing`
    const m = await ctxFor(MGR)
    try {
      await refuses(pref.saveCountryRule(await ctxFor(C), null, { countryId: c.id, documentTypeId: doc.id }), 'forbidden')
      await pref.saveCountryRule(m, null, { countryId: c.id, documentTypeId: doc.id, sourceNote: 'Fictional source' })
      const [r] = await sql`select * from country_document_rules where country_id = ${c.id} and document_type_id = ${doc.id}`
      expect(r).toMatchObject({ verification_status: 'unverified', is_active: false })
      await refuses(pref.setCountryRuleActive(m, r.id, true), 'Only a verified')
      await expect(sql`update country_document_rules set is_active = true where id = ${r.id}`).rejects.toMatchObject({ code: '23514' })
      await refuses(pref.verifyCountryRule(m, r.id, true, 'Fictional decision'), 'forbidden')
      await refuses(pref.verifyCountryRule(md, r.id, true, ''), 'based on')
      await pref.verifyCountryRule(md, r.id, true, 'Fictional decision')
      await pref.setCountryRuleActive(m, r.id, true)
      await pref.saveCountryRule(m, r.id, { countryId: c.id, documentTypeId: doc.id, guidance: 'Changed fictional guidance' })
      expect((await sql`select verification_status, is_active from country_document_rules where id = ${r.id}`)[0]).toEqual({ verification_status: 'unverified', is_active: false })
      expect((await sql`select count(*)::int as n from audit_logs where entity_type = 'country_document_rules' and entity_id = ${r.id}`)[0].n).toBeGreaterThan(3)
    } finally {
      await sql`delete from role_permissions where permission_key = 'requirements.manage' and role_id in (select id from roles where key = 'manager')`
      await sql`delete from country_document_rules where country_id = ${c.id} and document_type_id = ${doc.id}`
    }
  })

  it('Bulgaria rules come from the brief; no other country has one by default', async () => {
    const rows = await adminSql()`select c.code, d.key, r.match_rule, r.verification_status, r.is_active, r.guidance, st.permission_key from country_document_rules r join countries c on c.id = r.country_id join document_types d on d.id = r.document_type_id left join stages st on st.key = r.stage_key where r.source_note like 'MD brief%' order by d.key`
    expect(rows).toEqual([
      { code: 'BG', key: 'bonafide_certificate', match_rule: null, verification_status: 'verified', is_active: true, guidance: null, permission_key: null },
      { code: 'BG', key: 'police_clearance', match_rule: 'issuing_country_matches_visa_application_country', verification_status: 'verified', is_active: true, guidance: null, permission_key: 'stage.visa' },
    ])
  })
})

describe('academic years', () => {
  it('are managed by holders of master-data status, validated, and can be deactivated', async () => {
    const md = await ctxFor(MD)
    await refuses(pref.saveAcademicYear(await ctxFor(SA), null, '2031-32', null, true), 'forbidden')
    await refuses(pref.saveAcademicYear(md, null, 'next year', null, true), 'Write the year')
    const y = await year()
    await refuses(pref.saveAcademicYear(md, null, y.code, null, true), 'already exists')
    const id = await student(); const m = await ctxFor(MGR)
    await pref.savePreference(m, id, 2, { countryId: BG, academicYearId: y.id })
    await pref.saveAcademicYear(md, y.id, y.code, null, false)
    await refuses(pref.savePreference(m, id, 3, { countryId: RU, academicYearId: y.id }), 'active academic year')
    expect((await pref.studentPreferences(m, id))!.others[0].academic_year).toBe(y.code) // the record keeps it
    expect((await pref.studentPreferences(m, id))!.years.map((x) => x.id)).not.toContain(y.id)
  })
})
