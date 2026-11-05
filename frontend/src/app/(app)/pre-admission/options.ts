import type { Ctx } from '@/services/base'
import { dvrOrgs } from '@/services/dvr'
import { getLookups } from '@/services/lookups'

export async function dvrFormOptions(ctx: Ctx) {
  const l = await getLookups(ctx)
  const create = dvrOrgs(ctx).create
  return {
    orgs: ctx.memberships.filter((m) => create.includes(m.orgId)).map((m) => ({ id: m.orgId, name: m.orgName })),
    countries: l.countries.map((c) => ({ id: c.id, name: c.name, is_destination: c.is_destination })),
    universities: l.universities.map((u) => ({ id: u.id, name: u.name, country_id: u.country_id })),
    courses: l.courses.map((c) => ({ id: c.id, name: c.name })),
    intakes: [...new Set(l.intakes.map((i) => i.name))],
    documentTypes: l.documentTypes.map((d) => d.name),
  }
}
