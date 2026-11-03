import { can } from '../lib/auth/context'
import { forbidden, invalid, notFound } from '../lib/errors'
import { type Ctx, run } from './base'
import { conditionsFromForm } from './rules'

const UUID = /^[0-9a-f-]{36}$/i
const opt = (v?: string) => (v && UUID.test(v) ? v : null)

export const canManageRules = (ctx: Ctx) => can(ctx, 'verification.rules.manage')
export const canApproveRules = (ctx: Ctx) => can(ctx, 'verification.rules.approve')

export interface RuleRow {
  id: string; rule_group_id: string; version: number; name: string; description: string | null; status: string
  document_type: string; document_type_id: string; previous_education_country: string | null; destination_country: string | null
  university: string | null; course: string | null; effective_from: string | null; effective_to: string | null
  approved_by_name: string | null; approved_at: Date | null; requirements: number
  previous_education_country_id: string | null; destination_country_id: string | null; university_id: string | null; course_id: string | null
  conditions: import('@/lib/conditions').Condition | null
}

export async function listRules(ctx: Ctx, f: { status?: string } = {}) {
  return run(ctx, (tx) => tx<RuleRow[]>`
    select r.*, t.name as document_type, pc.name as previous_education_country, dc.name as destination_country, u.name as university,
           co.name as course, au.full_name as approved_by_name,
           (select count(*)::int from verification_requirements q where q.rule_id = r.id) as requirements
      from verification_rules r join document_types t on t.id = r.document_type_id
      left join countries pc on pc.id = r.previous_education_country_id
      left join countries dc on dc.id = r.destination_country_id
      left join universities u on u.id = r.university_id
      left join courses co on co.id = r.course_id
      left join user_profiles au on au.id = r.approved_by
     where ${f.status === 'all' ? tx`true` : tx`r.status <> 'retired'`}
     order by t.name, r.name, r.version desc`)
}

export async function getRule(ctx: Ctx, id: string) {
  if (!UUID.test(id)) return null
  return run(ctx, async (tx) => {
    const [rule] = await tx<RuleRow[]>`
      select r.*, t.name as document_type, pc.name as previous_education_country, dc.name as destination_country, u.name as university,
             co.name as course, au.full_name as approved_by_name, 0 as requirements
        from verification_rules r join document_types t on t.id = r.document_type_id
        left join countries pc on pc.id = r.previous_education_country_id
        left join countries dc on dc.id = r.destination_country_id
        left join universities u on u.id = r.university_id
        left join courses co on co.id = r.course_id
        left join user_profiles au on au.id = r.approved_by
       where r.id = ${id}`
    if (!rule) return null
    const requirements = await tx<{ id: string; sort_order: number; kind: string; text: string; keywords: string[]; is_mandatory: boolean; guidance: string | null }[]>`
      select id, sort_order, kind, text, keywords, is_mandatory, guidance from verification_requirements where rule_id = ${id} order by sort_order, created_at`
    const versions = await tx<{ id: string; version: number; status: string; effective_from: string | null; effective_to: string | null }[]>`
      select id, version, status, effective_from, effective_to from verification_rules where rule_group_id = ${rule.rule_group_id} order by version desc`
    const [usage] = await tx<{ n: number }[]>`select count(*)::int as n from document_verifications where rule_id = ${id}`
    return { rule, requirements, versions, usage: usage.n }
  })
}

function guardManage(ctx: Ctx) {
  if (!canManageRules(ctx)) throw forbidden('You do not have permission to manage verification rules.')
}

export async function saveRuleDraft(ctx: Ctx, id: string | null, v: Record<string, string | undefined>) {
  guardManage(ctx)
  const name = v.name?.trim()
  if (!name || name.length < 3) throw invalid('Enter a rule name.', { name: ['Required.'] })
  if (!opt(v.documentTypeId)) throw invalid('Choose the document type.', { documentTypeId: ['Required.'] })
  const cols = {
    name, description: v.description ?? null, document_type_id: v.documentTypeId,
    previous_education_country_id: opt(v.previousEducationCountryId), destination_country_id: opt(v.destinationCountryId),
    university_id: opt(v.universityId), course_id: opt(v.courseId),
  }
  const conditions = conditionsFromForm(v.conditions)
  return run(ctx, async (tx) => {
    Object.assign(cols, { conditions: conditions ? tx.json(conditions as never) : null })
    if (id) {
      const r = await tx`update verification_rules set ${tx(cols as never)} where id = ${id} and status = 'draft'`
      if (!r.count) throw invalid('Only draft rules can be edited. Create a new version instead.')
      return id
    }
    const [r] = await tx<{ id: string }[]>`insert into verification_rules ${tx({ ...cols, created_by: ctx.userId } as never)} returning id`
    return r.id
  })
}

export async function addRequirement(ctx: Ctx, ruleId: string, v: Record<string, string | undefined>) {
  guardManage(ctx)
  const kind = v.kind ?? ''
  if (!['exact_phrase', 'keywords', 'statement', 'manual_check'].includes(kind)) throw invalid('Choose the type of check.')
  const text = v.text?.trim()
  if (!text || text.length < 2) throw invalid('Enter the wording or check.', { text: ['Required.'] })
  const keywords = (v.keywords ?? '').split(',').map((k) => k.trim()).filter(Boolean).slice(0, 20)
  if (kind === 'keywords' && !keywords.length) throw invalid('Enter at least one keyword (comma-separated).', { keywords: ['Required.'] })
  return run(ctx, async (tx) => {
    const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(sort_order), 0)::int + 10 as n from verification_requirements where rule_id = ${ruleId}`
    await tx`insert into verification_requirements (rule_id, sort_order, kind, text, keywords, is_mandatory, guidance)
             values (${ruleId}, ${n}, ${kind}, ${text}, ${tx.array(keywords)}::text[], ${v.optional !== 'yes'}, ${v.guidance ?? null})`
  })
}

export async function removeRequirement(ctx: Ctx, requirementId: string) {
  guardManage(ctx)
  return run(ctx, async (tx) => {
    const r = await tx`delete from verification_requirements where id = ${requirementId}`
    if (!r.count) throw notFound()
  })
}

export async function approveRule(ctx: Ctx, ruleId: string) {
  if (!canApproveRules(ctx)) throw forbidden('Only the MD (or someone the MD authorises) can approve verification rules.')
  return run(ctx, (tx) => tx`select app.approve_verification_rule(${ruleId})`)
}

export async function newRuleVersion(ctx: Ctx, ruleId: string) {
  guardManage(ctx)
  const [{ id }] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.new_rule_version(${ruleId}) as id`)
  return id
}

export async function deleteDraft(ctx: Ctx, ruleId: string) {
  guardManage(ctx)
  return run(ctx, async (tx) => {
    const r = await tx`delete from verification_rules where id = ${ruleId} and status = 'draft'`
    if (!r.count) throw invalid('Only drafts can be deleted.')
  })
}
