import type { Ctx } from '@/services/base'
import { getLookups } from '@/services/lookups'

export async function ruleOptions(ctx: Ctx) {
  const l = await getLookups(ctx)
  return {
    documentTypes: l.documentTypes.map((d) => ({ value: d.id, label: d.name })),
    countries: l.countries.map((c) => ({ value: c.id, label: c.name })),
    universities: l.universities.map((u) => ({ value: u.id, label: u.name })),
    courses: l.courses.map((c) => ({ value: c.id, label: c.name })),
  }
}
