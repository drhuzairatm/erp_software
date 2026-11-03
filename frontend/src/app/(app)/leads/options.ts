import { can, orgsWith } from '@/server/auth/context'
import type { Ctx } from '@/server/services/base'
import { getLookups } from '@/server/services/lookups'
import type { LeadFormOptions } from './lead-forms'

export async function leadFormOptions(ctx: Ctx): Promise<LeadFormOptions> {
  const l = await getLookups(ctx)
  const manage = orgsWith(ctx, 'leads.manage')
  return {
    orgs: ctx.memberships.filter((m) => manage.includes(m.orgId)).map((m) => ({ value: m.orgId, label: m.orgName })),
    countries: l.countries.map((c) => ({ value: c.id, label: c.name })),
    courses: l.courses.map((c) => ({ value: c.id, label: c.name })),
    canCentral: can(ctx, 'leads.review'),
  }
}
