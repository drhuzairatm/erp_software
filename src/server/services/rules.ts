import type { ConditionOptions } from '@/components/condition-builder'
import { type Condition, describe, type Names, parseConditions, type Trace, trace } from '@/lib/conditions'
import { canAny } from '../auth/context'
import { forbidden, invalid } from '../errors'
import { type Ctx, run } from './base'
import { getLookups } from './lookups'

export const RULE_PERMS = ['verification.rules.manage', 'verification.rules.approve', 'attestation.routes.manage', 'attestation.routes.approve',
  'passport.rules.manage', 'academic.rules.manage', 'universities.manage']
export const canTestRules = (ctx: Ctx) => canAny(ctx, RULE_PERMS)

/** Options for the condition builder (reference data the user can see). */
export async function conditionOptions(ctx: Ctx): Promise<ConditionOptions> {
  const l = await getLookups(ctx)
  const uniCountry = Object.fromEntries(l.countries.map((c) => [c.id, c.name]))
  const uniName = Object.fromEntries(l.universities.map((u) => [u.id, u.name]))
  return {
    country: l.countries.map((c) => ({ value: c.id, label: c.name })),
    university: l.universities.map((u) => ({ value: u.id, label: `${u.name} (${uniCountry[u.country_id] ?? ''})` })),
    course: l.courses.map((c) => ({ value: c.id, label: c.name })),
    intake: l.intakes.map((i) => ({ value: i.id, label: `${i.name} – ${uniName[i.university_id] ?? ''}` })),
    company: l.organizations.map((o) => ({ value: o.id, label: o.name })),
    stage: l.stages.filter((s) => s.kind === 'normal').map((s) => ({ value: s.key, label: s.name })),
    document_type: l.documentTypes.map((d) => ({ value: d.id, label: d.name })),
    lead_source: l.leadSources.map((s) => ({ value: s.id, label: s.name })),
  }
}

export function namesOf(o: ConditionOptions): Names {
  return Object.fromEntries(Object.entries(o).map(([k, list]) => [k, Object.fromEntries((list ?? []).map((x) => [x.value, x.label]))])) as Names
}

/** Parses a submitted condition (JSON from the builder). */
export function conditionsFromForm(raw: string | undefined): Condition | null {
  try { return parseConditions(raw ?? null) } catch (e) { throw invalid((e as Error).message, { conditions: [(e as Error).message] }) }
}

type RuleResult = { kind: string; id: string; name: string; scope: string; scopeMatch: boolean; conditions: Condition | null; trace: Trace; applies: boolean; href: string }

/** Rule tester: which rules apply to a student (and document), and why. */
export async function testStudent(ctx: Ctx, code: string, documentId?: string) {
  if (!canTestRules(ctx)) throw forbidden()
  const options = await conditionOptions(ctx)
  const names = namesOf(options)
  return run(ctx, async (tx) => {
    const [s] = await tx<{ id: string; student_code: string; full_name: string }[]>`
      select id, student_code, full_name from v_students where upper(student_code) = upper(${code.trim()}) limit 1`
    if (!s) return null
    const docs = await tx<{ id: string; name: string }[]>`
      select d.id, t.name || case when d.label <> '' then ' – ' || d.label else '' end as name
        from student_documents d join document_types t on t.id = d.document_type_id where d.student_id = ${s.id} order by t.sort_order`
    const doc = documentId && docs.some((d) => d.id === documentId) ? documentId : null
    const [{ facts }] = await tx<{ facts: Record<string, string | number> }[]>`select app.rule_facts(${s.id}, ${doc}) as facts`
    const results: RuleResult[] = []
    const add = (kind: string, href: string, r: { id: string; name: string; scope: string; scope_match: boolean; conditions: Condition | null }) => {
      const t = trace(r.conditions, facts, names)
      results.push({ kind, id: r.id, name: r.name, scope: r.scope, scopeMatch: r.scope_match, conditions: r.conditions, trace: t, applies: r.scope_match && t.result, href })
    }
    for (const r of await tx<{ id: string; name: string; scope: string; scope_match: boolean; conditions: Condition | null }[]>`
      select r.id, r.name, concat_ws(' · ', 'from ' || st.name, c.name, u.name, co.name, r.min_months || ' months') as scope, r.conditions,
             ((r.destination_country_id is null or r.destination_country_id = s.destination_country_id)
              and (r.university_id is null or r.university_id = s.preferred_university_id) and (r.course_id is null or r.course_id = s.course_id)) as scope_match
        from passport_validity_rules r join students s on s.id = ${s.id} join stages st on st.key = r.stage_key
        left join countries c on c.id = r.destination_country_id left join universities u on u.id = r.university_id left join courses co on co.id = r.course_id
       where r.is_active order by r.name`) add('Passport validity', '/admin/passport-rules', r)
    for (const r of await tx<{ id: string; name: string; scope: string; scope_match: boolean; conditions: Condition | null }[]>`
      select r.id, r.name || ' (v' || r.version || ')' as name, concat_ws(' · ', t.name, pe.name, c.name, u.name, co.name) as scope, r.conditions,
             ((r.previous_education_country_id is null or r.previous_education_country_id = s.previous_education_country_id)
              and (r.destination_country_id is null or r.destination_country_id = s.destination_country_id)
              and (r.university_id is null or r.university_id = s.preferred_university_id) and (r.course_id is null or r.course_id = s.course_id)
              and (${doc}::uuid is null or exists (select 1 from student_documents d where d.id = ${doc} and d.document_type_id = r.document_type_id))) as scope_match
        from verification_rules r join students s on s.id = ${s.id} join document_types t on t.id = r.document_type_id
        left join countries pe on pe.id = r.previous_education_country_id left join countries c on c.id = r.destination_country_id
        left join universities u on u.id = r.university_id left join courses co on co.id = r.course_id
       where r.status = 'approved' and r.effective_from <= current_date and (r.effective_to is null or r.effective_to > current_date)
         and exists (select 1 from student_documents d where d.student_id = s.id and d.document_type_id = r.document_type_id)
       order by t.name, r.name`) add('Document verification', '/admin/verification-rules', r)
    for (const r of await tx<{ id: string; name: string; scope: string; scope_match: boolean; conditions: Condition | null }[]>`
      select r.id, r.name || ' (v' || r.version || ')' as name, concat_ws(' · ', c.name, ic.name, t.name, u.name) as scope, r.conditions,
             (r.destination_country_id = s.destination_country_id and (r.university_id is null or r.university_id = s.preferred_university_id)
              and (r.visa_application_country_id is null or r.visa_application_country_id = s.visa_application_country_id)
              and (r.previous_education_country_id is null or r.previous_education_country_id = s.previous_education_country_id)
              and (${doc}::uuid is null or exists (select 1 from student_documents d where d.id = ${doc}
                    and (r.document_type_id is null or r.document_type_id = d.document_type_id)
                    and (r.issuing_country_id is null or r.issuing_country_id = d.issuing_country_id)))) as scope_match
        from attestation_routes r join students s on s.id = ${s.id} join countries c on c.id = r.destination_country_id
        left join countries ic on ic.id = r.issuing_country_id left join document_types t on t.id = r.document_type_id left join universities u on u.id = r.university_id
       where r.status = 'approved' and r.effective_from <= current_date and (r.effective_to is null or r.effective_to > current_date)
       order by r.name`) add('Attestation route', '/admin/attestation-routes', r)
    for (const r of await tx<{ id: string; name: string; scope: string; scope_match: boolean; conditions: Condition | null }[]>`
      select r.id, r.name, concat_ws(' · ', r.requirement, c.name, u.name, co.name, replace(r.mismatch_type, '_', ' ')) as scope, r.conditions,
             ((r.destination_country_id is null or r.destination_country_id = s.destination_country_id)
              and (r.university_id is null or r.university_id = s.preferred_university_id) and (r.course_id is null or r.course_id = s.course_id)) as scope_match
        from one_and_same_rules r join students s on s.id = ${s.id}
        left join countries c on c.id = r.destination_country_id left join universities u on u.id = r.university_id left join courses co on co.id = r.course_id
       where r.is_active order by r.name`) add('One and Same', '/admin/academic-rules', r)
    for (const r of await tx<{ id: string; name: string; scope: string; scope_match: boolean; conditions: Condition | null }[]>`
      select r.id, t.name || ' – ' || u.name as name, case when r.is_required then 'required' else 'optional' end || coalesce(' · ' || co.name || ' only', '') as scope,
             r.conditions, (r.course_id is null or r.course_id = s.course_id) as scope_match
        from university_document_requirements r join students s on s.id = ${s.id} and s.preferred_university_id = r.university_id
        join document_types t on t.id = r.document_type_id join universities u on u.id = r.university_id left join courses co on co.id = r.course_id
       order by t.name`) add('University document (checklist)', '/universities', r)
    // Authoritative check: the database evaluator must agree with the explanation
    const ids = results.filter((r) => r.conditions).map((r) => ({ id: r.id, c: r.conditions }))
    for (const x of ids) {
      const [{ ok }] = await tx<{ ok: boolean }[]>`select app.condition_eval(${tx.json(x.c as never)}, app.rule_facts(${s.id}, ${doc})) as ok`
      const r = results.find((y) => y.id === x.id)!
      if (r.trace.result !== ok) { r.trace = { ...r.trace, result: ok, text: `${r.trace.text} (database result)` }; r.applies = r.scopeMatch && ok }
    }
    const factRows = Object.entries(facts).map(([k, v]) => ({ key: k, value: v }))
    return { student: s, documents: docs, document: doc, facts: factRows, results, names }
  })
}

/** Condition preview: how many current students would match, with examples. */
export async function previewCondition(ctx: Ctx, raw: string | undefined) {
  if (!canTestRules(ctx)) throw forbidden()
  const cond = conditionsFromForm(raw)
  const names = namesOf(await conditionOptions(ctx))
  return run(ctx, async (tx) => {
    const rows = await tx<{ id: string; student_code: string; full_name: string; total: number; matching: number }[]>`
      with base as (select id, student_code, full_name from v_students where status in ('active', 'on_hold') and archived_at is null),
           m as (select * from base where ${cond ? tx`app.conditions_match(${tx.json(cond as never)}, base.id, null)` : tx`true`})
      select m.id, m.student_code, m.full_name, (select count(*)::int from base) as total, (select count(*)::int from m) as matching
        from m order by m.student_code limit 20`
    const [t] = rows.length ? rows : await tx<{ total: number }[]>`select count(*)::int as total from v_students where status in ('active', 'on_hold') and archived_at is null`
    return { description: describe(cond, names), condition: cond, total: t?.total ?? 0, matching: rows[0]?.matching ?? 0, sample: rows }
  })
}
