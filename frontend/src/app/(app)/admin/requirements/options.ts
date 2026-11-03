import type { Ctx } from '@/services/base'
import { getLookups } from '@/services/lookups'

export async function requirementOptions(ctx: Ctx) {
  const l = await getLookups(ctx)
  return {
    countries: l.countries.filter((c) => c.is_destination).map((c) => ({ id: c.id, name: c.name })),
    universities: l.universities.map((u) => ({ id: u.id, name: u.name })),
    courses: l.courses.map((c) => ({ id: c.id, name: c.name })),
  }
}
