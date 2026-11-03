import { can } from '../lib/auth/context'
import { forbidden, invalid, notFound } from '../lib/errors'
import { refuseIfInfected } from '../lib/security/file-scan'
import { getStorage, MAX_UPLOAD_BYTES, newStorageKey, safeFilename, sha256, sniffMime } from '../lib/storage'
import { type Ctx, run } from './base'
import { conditionsFromForm } from './rules'

const UUID = /^[0-9a-f-]{36}$/i
const opt = (v?: string) => (v && UUID.test(v) ? v : null)

export const canManageRoutes = (ctx: Ctx) => can(ctx, 'attestation.routes.manage')
export const canApproveRoutes = (ctx: Ctx) => can(ctx, 'attestation.routes.approve')

// =============================================================== configuration
export interface RouteRow {
  id: string; route_group_id: string; version: number; name: string; description: string | null; route_type: string; status: string
  destination: string; destination_country_id: string; issuing_country: string | null; issuing_country_id: string | null
  document_type: string | null; document_type_id: string | null; university: string | null; university_id: string | null
  visa_application_country: string | null; visa_application_country_id: string | null
  previous_education_country: string | null; previous_education_country_id: string | null
  source_note: string | null; effective_from: string | null; effective_to: string | null; approved_by_name: string | null; approved_at: Date | null; stages: number
  conditions: import('@/lib/conditions').Condition | null
}

const ROUTE_SELECT = `
  select r.*, dc.name as destination, ic.name as issuing_country, t.name as document_type, u.name as university,
         vc.name as visa_application_country, pc.name as previous_education_country, au.full_name as approved_by_name,
         (select count(*)::int from attestation_route_stages s where s.route_id = r.id) as stages
    from attestation_routes r join countries dc on dc.id = r.destination_country_id
    left join countries ic on ic.id = r.issuing_country_id left join document_types t on t.id = r.document_type_id
    left join universities u on u.id = r.university_id left join countries vc on vc.id = r.visa_application_country_id
    left join countries pc on pc.id = r.previous_education_country_id left join user_profiles au on au.id = r.approved_by`

export async function listRoutes(ctx: Ctx, f: { status?: string } = {}) {
  return run(ctx, (tx) => tx.unsafe<RouteRow[]>(`${ROUTE_SELECT} where ${f.status === 'all' ? 'true' : "r.status <> 'retired'"} order by dc.name, r.name, r.version desc`))
}

export async function getRoute(ctx: Ctx, id: string) {
  if (!UUID.test(id)) return null
  return run(ctx, async (tx) => {
    const [route] = await tx.unsafe<RouteRow[]>(`${ROUTE_SELECT} where r.id = $1`, [id])
    if (!route) return null
    const stages = await tx<{ id: string; sort_order: number; name: string; authority_id: string | null; authority: string | null; is_mandatory: boolean;
      responsible_department: string | null; requires_reference: boolean; requires_supporting_file: boolean; expected_days: number | null; guidance: string | null }[]>`
      select s.*, a.name as authority from attestation_route_stages s left join attestation_authorities a on a.id = s.authority_id
       where s.route_id = ${id} order by s.sort_order`
    const versions = await tx<{ id: string; version: number; status: string; effective_from: string | null; effective_to: string | null }[]>`
      select id, version, status, effective_from, effective_to from attestation_routes where route_group_id = ${route.route_group_id} order by version desc`
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from document_attestations where route_id = ${id}`
    return { route, stages, versions, usage: n }
  })
}

function guardManage(ctx: Ctx) {
  if (!canManageRoutes(ctx)) throw forbidden('You do not have permission to manage attestation routes.')
}

export async function saveRouteDraft(ctx: Ctx, id: string | null, v: Record<string, string | undefined>) {
  guardManage(ctx)
  const name = v.name?.trim()
  if (!name || name.length < 3) throw invalid('Enter a route name.', { name: ['Required.'] })
  if (!opt(v.destinationCountryId)) throw invalid('Choose the destination country.', { destinationCountryId: ['Required.'] })
  if (!['apostille', 'legalisation', 'other'].includes(v.routeType ?? '')) throw invalid('Choose the route type.')
  const cols = {
    name, description: v.description ?? null, route_type: v.routeType, destination_country_id: v.destinationCountryId,
    issuing_country_id: opt(v.issuingCountryId), document_type_id: opt(v.documentTypeId), university_id: opt(v.universityId),
    visa_application_country_id: opt(v.visaApplicationCountryId), previous_education_country_id: opt(v.previousEducationCountryId),
    source_note: v.sourceNote ?? null,
  }
  const conditions = conditionsFromForm(v.conditions)
  return run(ctx, async (tx) => {
    Object.assign(cols, { conditions: conditions ? tx.json(conditions as never) : null })
    if (id) {
      const r = await tx`update attestation_routes set ${tx(cols as never)} where id = ${id} and status = 'draft'`
      if (!r.count) throw invalid('Only draft routes can be edited. Create a new version instead.')
      return id
    }
    const [r] = await tx<{ id: string }[]>`insert into attestation_routes ${tx({ ...cols, created_by: ctx.userId } as never)} returning id`
    return r.id
  })
}

export async function addStage(ctx: Ctx, routeId: string, v: Record<string, string | undefined>) {
  guardManage(ctx)
  const name = v.name?.trim()
  if (!name || name.length < 2) throw invalid('Enter the stage name.', { name: ['Required.'] })
  const days = v.expectedDays ? Number(v.expectedDays) : null
  if (days !== null && !(Number.isInteger(days) && days >= 0 && days <= 365)) throw invalid('Expected days must be 0–365.')
  return run(ctx, async (tx) => {
    const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(sort_order), 0)::int + 10 as n from attestation_route_stages where route_id = ${routeId}`
    await tx`insert into attestation_route_stages (route_id, sort_order, name, authority_id, is_mandatory, responsible_department,
                                                   requires_reference, requires_supporting_file, expected_days, guidance)
             values (${routeId}, ${n}, ${name}, ${opt(v.authorityId)}, ${v.optional !== 'yes'}, ${v.responsibleDepartment ?? null},
                     ${v.requiresReference === 'yes'}, ${v.requiresFile === 'yes'}, ${days}, ${v.guidance ?? null})`
  })
}

export async function removeStage(ctx: Ctx, stageId: string) {
  guardManage(ctx)
  return run(ctx, async (tx) => {
    const r = await tx`delete from attestation_route_stages where id = ${stageId}`
    if (!r.count) throw notFound()
  })
}

/** Move a stage up or down (drafts only). */
export async function moveStage(ctx: Ctx, stageId: string, direction: 'up' | 'down') {
  guardManage(ctx)
  return run(ctx, async (tx) => {
    const [s] = await tx<{ id: string; route_id: string; sort_order: number }[]>`select id, route_id, sort_order from attestation_route_stages where id = ${stageId}`
    if (!s) throw notFound()
    const [other] = direction === 'up'
      ? await tx<{ id: string; sort_order: number }[]>`select id, sort_order from attestation_route_stages where route_id = ${s.route_id} and sort_order < ${s.sort_order} order by sort_order desc limit 1`
      : await tx<{ id: string; sort_order: number }[]>`select id, sort_order from attestation_route_stages where route_id = ${s.route_id} and sort_order > ${s.sort_order} order by sort_order limit 1`
    if (!other) return
    await tx`update attestation_route_stages set sort_order = -1 where id = ${s.id}`
    await tx`update attestation_route_stages set sort_order = ${s.sort_order} where id = ${other.id}`
    await tx`update attestation_route_stages set sort_order = ${other.sort_order} where id = ${s.id}`
  })
}

export async function approveRoute(ctx: Ctx, id: string) {
  if (!canApproveRoutes(ctx)) throw forbidden('Only the MD (or someone the MD authorises) can approve attestation routes.')
  return run(ctx, (tx) => tx`select app.approve_attestation_route(${id})`)
}

export async function newRouteVersion(ctx: Ctx, id: string) {
  guardManage(ctx)
  const [{ v }] = await run(ctx, (tx) => tx<{ v: string }[]>`select app.new_attestation_route_version(${id}) as v`)
  return v
}

export async function deleteRouteDraft(ctx: Ctx, id: string) {
  guardManage(ctx)
  return run(ctx, async (tx) => {
    const r = await tx`delete from attestation_routes where id = ${id} and status = 'draft'`
    if (!r.count) throw invalid('Only drafts can be deleted.')
  })
}

export async function listAuthorities(ctx: Ctx) {
  return run(ctx, (tx) => tx<{ id: string; name: string; kind: string; country: string | null; country_id: string | null; is_active: boolean; notes: string | null }[]>`
    select a.id, a.name, a.kind, c.name as country, a.country_id, a.is_active, a.notes from attestation_authorities a left join countries c on c.id = a.country_id
     order by c.name nulls first, a.name`)
}

export async function addAuthority(ctx: Ctx, v: Record<string, string | undefined>) {
  guardManage(ctx)
  const name = v.name?.trim()
  if (!name || name.length < 2) throw invalid('Enter the authority name.')
  return run(ctx, (tx) => tx`insert into attestation_authorities (name, country_id, kind, notes) values (${name}, ${opt(v.countryId)}, ${v.kind ?? 'other'}, ${v.notes ?? null})`)
}

export async function toggleAuthority(ctx: Ctx, id: string, active: boolean) {
  guardManage(ctx)
  return run(ctx, (tx) => tx`update attestation_authorities set is_active = ${active} where id = ${id}`)
}

// =============================================================== work on documents
export interface StepRow {
  id: string; sort_order: number; name: string; authority_name: string | null; is_mandatory: boolean; responsible_department: string | null
  requires_reference: boolean; requires_supporting_file: boolean; expected_days: number | null; guidance: string | null; status: string
  assigned_to: string | null; assignee: string | null; started_at: Date | null; processing_date: string | null; reference_no: string | null
  comments: string | null; completed_at: Date | null; completer: string | null; exception_reason: string | null
}

export async function getDocumentAttestation(ctx: Ctx, documentId: string) {
  if (!UUID.test(documentId)) return null
  return run(ctx, async (tx) => {
    const [doc] = await tx<{ student_id: string; status: string; issuing_country_id: string | null; issuing_country: string | null }[]>`
      select d.student_id, d.status, d.issuing_country_id, c.name as issuing_country from student_documents d
        left join countries c on c.id = d.issuing_country_id where d.id = ${documentId}`
    if (!doc) return null
    const [state] = await tx<{ state: string | null; attestation_id: string | null; done: number; total: number }[]>`select * from app.attestation_state(${documentId})`
    const routes = await tx.unsafe<(RouteRow & { stage_names: string[] })[]>(
      `${ROUTE_SELECT.replace('as stages', 'as stages, array(select s2.name from attestation_route_stages s2 where s2.route_id = r.id order by s2.sort_order) as stage_names')}
        where r.id in (select route_id from app.matching_attestation_routes($1)) order by r.name`, [documentId])
    const history = await tx<{ id: string; route_name: string; route_version: number; route_type: string; status: string; started_at: Date; completed_at: Date | null;
      cancelled_at: Date | null; cancel_reason: string | null; starter: string | null; file_version: number }[]>`
      select a.id, a.route_name, a.route_version, a.route_type, a.status, a.started_at, a.completed_at, a.cancelled_at, a.cancel_reason,
             u.full_name as starter, f.version as file_version
        from document_attestations a left join user_profiles u on u.id = a.started_by join document_files f on f.id = a.file_id
       where a.student_document_id = ${documentId} order by a.started_at desc`
    const current = history.find((h) => h.id === state.attestation_id) ?? null
    const steps = current ? await tx<StepRow[]>`
      select s.*, au.full_name as assignee, cu.full_name as completer from document_attestation_steps s
        left join user_profiles au on au.id = s.assigned_to left join user_profiles cu on cu.id = s.completed_by
       where s.attestation_id = ${current.id} order by s.sort_order` : []
    const files = steps.length ? await tx<{ id: string; step_id: string; filename: string; uploaded_at: Date; uploader: string | null }[]>`
      select f.id, f.step_id, f.filename, f.uploaded_at, u.full_name as uploader from attestation_step_files f left join user_profiles u on u.id = f.uploaded_by
       where f.step_id = any(${tx.array(steps.map((s) => s.id))}::uuid[]) order by f.uploaded_at` : []
    const [perms] = await tx<{ process: boolean; exception: boolean; file_view: boolean }[]>`
      select app.can_on_student(${doc.student_id}, 'attestation.process') as process, app.can_on_student(${doc.student_id}, 'attestation.exception') as exception,
             app.can_on_student(${doc.student_id}, 'documents.file.view') as file_view`
    const staff = perms.process ? await tx<{ id: string; full_name: string }[]>`
      select distinct u.id, u.full_name from student_org_access x join organization_memberships m on m.org_id = x.org_id and m.is_active
        join user_profiles u on u.id = m.user_id and u.is_active where x.student_id = ${doc.student_id} order by u.full_name` : []
    return { doc, state, routes, history, current, steps, files, perms, staff }
  })
}

export async function startAttestation(ctx: Ctx, documentId: string, routeId: string) {
  if (!UUID.test(routeId)) throw invalid('Choose a route.')
  return run(ctx, (tx) => tx`select app.start_attestation(${documentId}, ${routeId})`)
}

export const STEP_ACTIONS = ['start', 'complete', 'not_required', 'exception', 'assign', 'note'] as const

export async function stepAction(ctx: Ctx, stepId: string, action: string, v: { reference?: string; date?: string; comment?: string; assignee?: string }) {
  if (!(STEP_ACTIONS as readonly string[]).includes(action)) throw invalid('Unknown action.')
  if (v.date && !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw invalid('Use a valid date.')
  return run(ctx, (tx) => tx`select app.attestation_step_action(${stepId}, ${action}, ${v.reference ?? null}, ${v.date ?? null}, ${v.comment ?? null},
                                                                 ${v.assignee && UUID.test(v.assignee) ? v.assignee : null})`)
}

export async function cancelAttestation(ctx: Ctx, attestationId: string, reason: string) {
  return run(ctx, (tx) => tx`select app.cancel_attestation(${attestationId}, ${reason ?? null})`)
}

export async function uploadStepFile(ctx: Ctx, stepId: string, file: File) {
  if (!(file instanceof File) || file.size === 0) throw invalid('Choose a file.')
  if (file.size > MAX_UPLOAD_BYTES) throw invalid('The file is larger than 10 MB.')
  const buf = Buffer.from(await file.arrayBuffer())
  const mime = sniffMime(buf)
  if (!mime) throw invalid('Only PDF, JPEG, PNG or WebP files are accepted.')
  const [t] = await run(ctx, (tx) => tx<{ student_id: string; org_id: string }[]>`select * from app.attestation_file_target(${stepId})`)
  if (!t) throw forbidden()
  await refuseIfInfected(ctx, buf, `attestation step ${stepId}`)
  const storage = await getStorage()
  const key = newStorageKey(t.org_id, t.student_id)
  await storage.put(key, buf, mime)
  try {
    await run(ctx, (tx) => tx`select app.register_attestation_file(${stepId}, ${key}, ${safeFilename(file.name)}, ${mime}, ${buf.length}, ${sha256(buf)})`)
  } catch (e) {
    await storage.remove(key).catch(() => {})
    throw e
  }
}

export async function attestationFileContent(ctx: Ctx, fileId: string) {
  if (!UUID.test(fileId)) return null
  const [f] = await run(ctx, (tx) => tx<{ storage_key: string; mime_type: string; filename: string }[]>`select * from app.authorize_attestation_file(${fileId})`)
  if (!f) return null
  return { data: await (await getStorage()).get(f.storage_key), mime: f.mime_type, filename: f.filename }
}
