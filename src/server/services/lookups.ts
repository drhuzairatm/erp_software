import type { Tx } from '../db'
import { type Ctx, run } from './base'

export interface Option { id: string; name: string; extra?: string | null }

export async function getLookups(ctx: Ctx) {
  return run(ctx, async (tx) => loadLookups(tx))
}

export async function loadLookups(tx: Tx) {
  const [countries, courses, universities, stages, organizations, leadSources, legalEntities, documentTypes, campuses] = await Promise.all([
    tx<(Option & { is_destination: boolean; is_education_origin: boolean })[]>`select id, name, is_destination, is_education_origin from countries where is_active order by name`,
    tx<Option[]>`select id, name from courses where is_active order by sort_order, name`,
    tx<(Option & { country_id: string })[]>`select id, name, country_id from universities where is_active order by name`,
    tx<{ key: string; name: string; kind: string; sort_order: number; permission_key: string }[]>`select key, name, kind, sort_order, permission_key from stages order by sort_order`,
    tx<(Option & { code: string })[]>`select id, name, code from organizations where is_active order by name`,
    tx<(Option & { org_id: string })[]>`select id, name, org_id from lead_sources where is_active order by name`,
    tx<Option[]>`select id, name from legal_entities where is_active order by name`,
    tx<(Option & { key: string; category: string; has_expiry: boolean })[]>`select id, name, key, category, has_expiry from document_types where is_active order by sort_order`,
    tx<(Option & { university_id: string })[]>`select id, name, university_id from university_campuses where is_active order by name`,
  ])
  return { countries, courses, universities, stages, organizations, leadSources, legalEntities, documentTypes, campuses }
}

export type Lookups = Awaited<ReturnType<typeof loadLookups>>

/** Active staff of the given companies (for assignment pickers). */
export async function staffOf(tx: Tx, orgIds: string[]) {
  if (!orgIds.length) return []
  return tx<{ id: string; full_name: string; org_id: string; role_key: string; role_name: string; perms: string[] }[]>`
    select u.id, u.full_name, m.org_id, r.key as role_key, r.name as role_name,
           array(select permission_key from role_permissions where role_id = r.id) as perms
      from organization_memberships m
      join user_profiles u on u.id = m.user_id and u.is_active
      join roles r on r.id = m.role_id
     where m.is_active and m.org_id = any(${tx.array(orgIds)}::uuid[])
     order by u.full_name`
}
