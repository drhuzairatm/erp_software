import { can, canAny } from '../auth/context'
import { forbidden, invalid } from '../errors'
import { type Ctx, run } from './base'

const UUID = /^[0-9a-f-]{36}$/i
const opt = (v?: string | null) => (v && UUID.test(v) ? v : null)

export const MD_PERMS = ['masterdata.view', 'countries.manage', 'universities.manage', 'courses.manage', 'masterdata.status', 'requirements.manage',
  'workflow.manage', 'attestation.routes.manage', 'verification.rules.manage', 'academic.rules.manage', 'passport.rules.manage'] as const
export const canSeeMasterData = (ctx: Ctx) => canAny(ctx, [...MD_PERMS])
export const mdCan = (ctx: Ctx, p: (typeof MD_PERMS)[number]) => can(ctx, p)

// ---------------------------------------------------------------- countries
export interface CountryRow { id: string; code: string; name: string; nationality: string | null; currency_code: string | null; notes: string | null
  is_active: boolean; is_destination: boolean; is_education_origin: boolean; universities: number; students: number; course_names: string[] }

export async function listCountries(ctx: Ctx) {
  if (!canSeeMasterData(ctx)) throw forbidden()
  return run(ctx, (tx) => tx<CountryRow[]>`
    select c.id, c.code, c.name, c.nationality, c.currency_code, c.notes, c.is_active, c.is_destination, c.is_education_origin,
           (select count(*)::int from universities u where u.country_id = c.id) as universities,
           (select count(*)::int from students s where s.destination_country_id = c.id and s.status in ('active', 'on_hold')) as students,
           array(select co.name from course_countries cc join courses co on co.id = cc.course_id where cc.country_id = c.id and cc.is_active order by co.sort_order) as course_names
      from countries c order by c.is_active desc, c.name`)
}

export async function saveCountry(ctx: Ctx, id: string | null, v: Record<string, string | undefined>) {
  if (!mdCan(ctx, 'countries.manage')) throw forbidden()
  const code = (v.code ?? '').trim().toUpperCase()
  const name = v.name?.trim()
  if (!/^[A-Z]{2}$/.test(code)) throw invalid('Use the 2-letter ISO country code, e.g. BG.', { code: ['2 letters.'] })
  if (!name || name.length < 2) throw invalid('Enter the country name.', { name: ['Required.'] })
  const vals = { code, name, nationality: v.nationality?.trim() || null, currency_code: v.currencyCode && /^[A-Z]{3}$/.test(v.currencyCode) ? v.currencyCode : null,
    notes: v.notes?.trim() || null, is_destination: v.use !== 'origin', is_education_origin: v.use === 'origin' || v.use === 'both' }
  return run(ctx, async (tx) => {
    const dup = await tx`select 1 from countries where (code = ${code} or lower(name) = lower(${name})) and id is distinct from ${id}`
    if (dup.length) throw invalid('A country with this code or name already exists.')
    if (id) { const r = await tx`update countries set ${tx(vals as never)} where id = ${id}`; if (!r.count) throw forbidden() }
    else await tx`insert into countries ${tx(vals as never)}`
  })
}

/** Activate / deactivate a country, university or course (masterdata.status). Existing students keep their selection. */
export async function setMasterStatus(ctx: Ctx, kind: 'country' | 'university' | 'course', id: string, active: boolean) {
  if (!mdCan(ctx, 'masterdata.status')) throw forbidden()
  const table = { country: 'countries', university: 'universities', course: 'courses' }[kind]
  return run(ctx, async (tx) => {
    const r = await tx`update ${tx(table)} set is_active = ${active} where id = ${id}`
    if (!r.count) throw forbidden()
  })
}

// ---------------------------------------------------------------- courses
export interface CourseRow { id: string; code: string; name: string; category: string; parent_course_id: string | null; parent: string | null
  default_duration_years: string | null; eligibility: string | null; notes: string | null; is_active: boolean; academic_profile: string
  country_ids: string[]; universities: { id: string; name: string; country: string }[]; students: number }

export async function listCourses(ctx: Ctx) {
  if (!canSeeMasterData(ctx)) throw forbidden()
  return run(ctx, (tx) => tx<CourseRow[]>`
    select c.id, c.code, c.name, c.category, c.parent_course_id, p.name as parent, c.default_duration_years, c.eligibility, c.notes, c.is_active, c.academic_profile,
           array(select cc.country_id from course_countries cc where cc.course_id = c.id and cc.is_active) as country_ids,
           coalesce((select json_agg(json_build_object('id', u.id, 'name', u.name, 'country', co.name) order by co.name, u.name)
                       from university_courses uc join universities u on u.id = uc.university_id join countries co on co.id = u.country_id
                      where uc.course_id = c.id and uc.is_active), '[]') as universities,
           (select count(*)::int from students s where s.course_id = c.id and s.status in ('active', 'on_hold')) as students
      from courses c left join courses p on p.id = c.parent_course_id order by c.is_active desc, c.category, c.sort_order, c.name`)
}

export async function saveCourse(ctx: Ctx, id: string | null, v: Record<string, string | undefined>) {
  if (!mdCan(ctx, 'courses.manage')) throw forbidden()
  const name = v.name?.trim()
  if (!name || name.length < 2) throw invalid('Enter the course name.', { name: ['Required.'] })
  const category = v.category?.trim() || 'Other'
  const duration = v.duration?.trim() ? Number(v.duration) : null
  if (duration !== null && !(duration >= 0.5 && duration <= 10)) throw invalid('Duration: 0.5 to 10 years.', { duration: ['0.5–10.'] })
  const parent = opt(v.parentCourseId)
  if (parent && parent === id) throw invalid('A course cannot be a specialisation of itself.')
  const vals = { name, category: category.slice(0, 60), parent_course_id: parent, default_duration_years: duration, eligibility: v.eligibility?.trim() || null,
    notes: v.notes?.trim() || null }
  return run(ctx, async (tx) => {
    if ((await tx`select 1 from courses where lower(name) = lower(${name}) and id is distinct from ${id}`).length) throw invalid('A course with this name already exists.')
    let courseId = id
    if (id) { const r = await tx`update courses set ${tx(vals as never)} where id = ${id}`; if (!r.count) throw forbidden() }
    else {
      const code = (v.code?.trim() || name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
      if (code.length < 2) throw invalid('Enter a course code.', { code: ['Required.'] })
      const [r] = await tx<{ id: string }[]>`insert into courses ${tx({ ...vals, code, academic_profile: v.profile === 'pg_medical' ? 'pg_medical' : 'school' } as never)} returning id`
      courseId = r.id
    }
    // course ↔ country offerings (optional)
    const wanted = (v.countryIds ?? '').split(',').filter((x) => UUID.test(x))
    await tx`update course_countries set is_active = false where course_id = ${courseId} and not (country_id = any(${wanted}::uuid[])) and is_active`
    for (const c of wanted) {
      await tx`insert into course_countries (course_id, country_id) values (${courseId}, ${c}) on conflict (course_id, country_id) do update set is_active = true`
    }
  })
}

// ---------------------------------------------------------------- requests
export interface RequestRow { id: string; kind: 'country' | 'university' | 'course'; name: string; country: string | null; details: string | null; status: string
  requested_by_name: string; requested_at: Date; decided_by_name: string | null; decided_at: Date | null; decision_note: string | null }

export async function listRequests(ctx: Ctx) {
  return run(ctx, (tx) => tx<RequestRow[]>`
    select r.id, r.kind, r.name, c.name as country, r.details, r.status, u.full_name as requested_by_name, r.requested_at, d.full_name as decided_by_name,
           r.decided_at, r.decision_note
      from masterdata_requests r left join countries c on c.id = r.country_id join user_profiles u on u.id = r.requested_by left join user_profiles d on d.id = r.decided_by
     order by (r.status = 'pending') desc, r.requested_at desc limit 200`)
}

export async function requestMasterData(ctx: Ctx, v: Record<string, string | undefined>) {
  const kind = v.kind as 'country' | 'university' | 'course'
  if (!['country', 'university', 'course'].includes(kind)) throw invalid('Choose what is missing.')
  if (!v.name?.trim()) throw invalid('Enter the name.', { name: ['Required.'] })
  if (kind === 'university' && !opt(v.countryId)) throw invalid('Choose the country of the university.', { countryId: ['Required.'] })
  return run(ctx, (tx) => tx`select app.request_master_data(${kind}, ${v.name!.trim()}, ${opt(v.countryId)}, ${v.details?.trim() || null})`)
}

export async function decideRequest(ctx: Ctx, id: string, approve: boolean, note?: string, code?: string) {
  return run(ctx, async (tx) => {
    const [r] = await tx<{ id: string | null }[]>`select app.decide_master_data_request(${id}, ${approve}, ${note?.trim() || null}, ${code?.trim().toUpperCase() || null}) as id`
    return r.id
  })
}

// ---------------------------------------------------------------- permissions overview and history
export async function masterDataPermissions(ctx: Ctx) {
  if (!canSeeMasterData(ctx)) throw forbidden()
  return run(ctx, (tx) => tx<{ org_name: string; role_id: string; role_name: string; is_protected: boolean; perms: string[]; people: string[] }[]>`
    select o.name as org_name, r.id as role_id, r.name as role_name, r.is_protected,
           case when r.is_protected then ${[...MD_PERMS]}::text[] else array(select rp.permission_key from role_permissions rp where rp.role_id = r.id and rp.permission_key = any(${[...MD_PERMS]}::text[]) order by 1) end as perms,
           array(select u.full_name from organization_memberships m join user_profiles u on u.id = m.user_id where m.role_id = r.id and m.is_active order by 1) as people
      from roles r join organizations o on o.id = r.org_id
     where r.is_protected or exists (select 1 from role_permissions rp where rp.role_id = r.id and rp.permission_key = any(${[...MD_PERMS]}::text[]))
     order by o.name, r.is_protected desc, r.name`)
}

export async function masterDataHistory(ctx: Ctx) {
  if (!canSeeMasterData(ctx)) throw forbidden()
  return run(ctx, (tx) => tx<{ id: string; occurred_at: Date; actor: string | null; action: string; entity_type: string; before_data: unknown; after_data: unknown }[]>`
    select * from app.master_data_history(${[...MD_PERMS]}::text[])`)
}

/** The student's current country / university / course (even if since deactivated) for the edit form. */
export async function currentSelections(ctx: Ctx, studentId: string) {
  const [r] = await run(ctx, (tx) => tx<{ cid: string | null; cname: string | null; uid: string | null; uname: string | null; ucountry: string | null; kid: string | null; kname: string | null }[]>`
    select s.destination_country_id as cid, c.name as cname, s.preferred_university_id as uid, u.name as uname, u.country_id as ucountry, s.course_id as kid, k.name as kname
      from v_students s left join countries c on c.id = s.destination_country_id left join universities u on u.id = s.preferred_university_id
      left join courses k on k.id = s.course_id where s.id = ${studentId}`)
  if (!r) return {}
  return {
    country: r.cid ? { id: r.cid, name: r.cname ?? '' } : null,
    university: r.uid ? { id: r.uid, name: r.uname ?? '', country_id: r.ucountry ?? '' } : null,
    course: r.kid ? { id: r.kid, name: r.kname ?? '' } : null,
  }
}

/** Names as they were when selected, plus whether the records are still active (history is preserved). */
export async function selectionHistory(ctx: Ctx, studentId: string) {
  const [r] = await run(ctx, (tx) => tx<{ country: string | null; university: string | null; course: string | null; country_active: boolean | null; university_active: boolean | null; course_active: boolean | null }[]>`
    select st.destination_name_at_selection as country, st.university_name_at_selection as university, st.course_name_at_selection as course,
           c.is_active as country_active, u.is_active as university_active, k.is_active as course_active
      from students st left join countries c on c.id = st.destination_country_id left join universities u on u.id = st.preferred_university_id
      left join courses k on k.id = st.course_id where st.id = ${studentId} and app.can_read_student(st.id)`)
  return r ?? null
}
