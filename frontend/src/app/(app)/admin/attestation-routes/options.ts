import type { Ctx } from '@/server/services/base'
import { listAuthorities } from '@/server/services/attestation'
import { getLookups } from '@/server/services/lookups'
import { run } from '@/server/services/base'
import type { RouteOptions } from './route-forms'

export async function routeOptions(ctx: Ctx): Promise<RouteOptions> {
  const [l, auths, depts] = await Promise.all([getLookups(ctx), listAuthorities(ctx),
    run(ctx, (tx) => tx<{ name: string }[]>`select distinct name from departments where is_active order by name`)])
  return {
    countries: l.countries.map((c) => ({ value: c.id, label: c.name })),
    documentTypes: l.documentTypes.map((d) => ({ value: d.id, label: d.name })),
    universities: l.universities.map((u) => ({ value: u.id, label: u.name })),
    authorities: auths.filter((a) => a.is_active).map((a) => ({ value: a.id, label: `${a.name}${a.country ? ` (${a.country})` : ''}` })),
    departments: depts.map((d) => d.name),
  }
}
