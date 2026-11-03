import { can } from '../lib/auth/context'
import { forbidden, invalid, notFound } from '../lib/errors'
import { type Ctx, run } from './base'
import { conditionsFromForm } from './rules'

const UUID = /^[0-9a-f-]{36}$/i
const isDate = (s?: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s)

export function canManageUniversities(ctx: Ctx) {
  return can(ctx, 'universities.manage')
}

export async function listUniversities(ctx: Ctx, f: { country?: string; q?: string; inactive?: string }) {
  return run(ctx, async (tx) => {
    const conds = [f.inactive === 'yes' ? tx`true` : tx`u.is_active`]
    if (f.country && UUID.test(f.country)) conds.push(tx`u.country_id = ${f.country}`)
    if (f.q?.trim()) conds.push(tx`u.name ilike ${'%' + f.q.trim().slice(0, 80).replace(/[\\%_]/g, (m) => '\\' + m) + '%'}`)
    const where = conds.reduce((a, c) => tx`${a} and ${c}`)
    return tx<{ id: string; name: string; city: string | null; country: string; is_active: boolean; campuses: number; courses: string[]; next_deadline: string | null; doc_reqs: number; students: number }[]>`
      select u.id, u.name, u.city, c.name as country, u.is_active,
             (select count(*)::int from university_campuses x where x.university_id = u.id and x.is_active) as campuses,
             array(select co.name from university_courses uc join courses co on co.id = uc.course_id where uc.university_id = u.id and uc.is_active order by co.sort_order) as courses,
             (select min(application_deadline) from university_intakes i where i.university_id = u.id and i.is_active and i.application_deadline >= current_date) as next_deadline,
             (select count(*)::int from university_document_requirements r where r.university_id = u.id) as doc_reqs,
             (select count(*)::int from v_students s where s.preferred_university_id = u.id and s.status in ('active', 'on_hold')) as students
        from universities u join countries c on c.id = u.country_id
       where ${where}
       order by c.name, u.name`
  })
}

export async function getUniversity(ctx: Ctx, id: string) {
  if (!UUID.test(id)) return null
  return run(ctx, async (tx) => {
    const [u] = await tx<{ id: string; name: string; city: string | null; website: string | null; notes: string | null; is_active: boolean; country_id: string; country: string }[]>`
      select u.id, u.name, u.city, u.website, u.notes, u.is_active, u.country_id, c.name as country
        from universities u join countries c on c.id = u.country_id where u.id = ${id}`
    if (!u) return null
    const [campuses, courses, intakes, requirements] = await Promise.all([
      tx<{ id: string; name: string; city: string | null; is_active: boolean }[]>`select id, name, city, is_active from university_campuses where university_id = ${id} order by name`,
      tx<{ id: string; course_id: string; course: string; duration_years: string | null; medium: string | null; eligibility: string | null; notes: string | null; is_active: boolean }[]>`
        select uc.id, uc.course_id, co.name as course, uc.duration_years, uc.medium, uc.eligibility, uc.notes, uc.is_active
          from university_courses uc join courses co on co.id = uc.course_id where uc.university_id = ${id} order by co.sort_order`,
      tx<{ id: string; name: string; course: string | null; application_deadline: string | null; starts_on: string | null; is_active: boolean }[]>`
        select i.id, i.name, co.name as course, i.application_deadline, i.starts_on, i.is_active
          from university_intakes i left join courses co on co.id = i.course_id where i.university_id = ${id}
         order by i.application_deadline nulls last`,
      tx<{ id: string; document: string; course: string | null; is_required: boolean; notes: string | null; conditions: import('@/lib/conditions').Condition | null }[]>`
        select r.id, t.name as document, co.name as course, r.is_required, r.notes, r.conditions
          from university_document_requirements r join document_types t on t.id = r.document_type_id
          left join courses co on co.id = r.course_id where r.university_id = ${id} order by t.sort_order`,
    ])
    return { university: u, campuses, courses, intakes, requirements }
  })
}

function guard(ctx: Ctx) {
  if (!canManageUniversities(ctx)) throw forbidden('You do not have permission to manage universities.')
}

export async function saveUniversity(ctx: Ctx, id: string | null, v: Record<string, string | undefined>) {
  guard(ctx)
  const name = v.name?.trim()
  if (!name || name.length < 2) throw invalid('Enter the university name.', { name: ['Required.'] })
  if (v.website && !/^https?:\/\/\S+$/i.test(v.website)) throw invalid('Website must start with http:// or https://', { website: ['Invalid URL.'] })
  return run(ctx, async (tx) => {
    if (id) {
      const r = await tx`update universities set name = ${name}, city = ${v.city ?? null}, website = ${v.website ?? null}, notes = ${v.notes ?? null},
                                               is_active = ${v.active !== 'no'} where id = ${id}`
      if (!r.count) throw notFound()
      return id
    }
    if (!v.countryId || !UUID.test(v.countryId)) throw invalid('Choose the country.', { countryId: ['Required.'] })
    const [u] = await tx<{ id: string }[]>`insert into universities (country_id, name, city, website, notes)
                                          values (${v.countryId}, ${name}, ${v.city ?? null}, ${v.website ?? null}, ${v.notes ?? null}) returning id`
    return u.id
  })
}

type Part = 'campus' | 'course' | 'intake' | 'requirement'

export async function addUniversityPart(ctx: Ctx, universityId: string, part: Part, v: Record<string, string | undefined>) {
  guard(ctx)
  return run(ctx, async (tx) => {
    switch (part) {
      case 'campus':
        if (!v.name?.trim()) throw invalid('Enter the campus name.')
        return tx`insert into university_campuses (university_id, name, city) values (${universityId}, ${v.name.trim()}, ${v.city ?? null})`
      case 'course': {
        if (!v.courseId) throw invalid('Choose a course.')
        const years = v.durationYears ? Number(v.durationYears) : null
        if (years !== null && !(years >= 0.5 && years <= 10)) throw invalid('Duration must be between 0.5 and 10 years.')
        return tx`insert into university_courses (university_id, course_id, duration_years, medium, eligibility, notes)
                  values (${universityId}, ${v.courseId}, ${years}, ${v.medium ?? null}, ${v.eligibility ?? null}, ${v.notes ?? null})
                  on conflict (university_id, course_id) do update set duration_years = excluded.duration_years, medium = excluded.medium,
                     eligibility = excluded.eligibility, notes = excluded.notes, is_active = true`
      }
      case 'intake':
        if (!v.name?.trim()) throw invalid('Enter the intake name, e.g. "September 2027".')
        if (!isDate(v.applicationDeadline) || !isDate(v.startsOn)) throw invalid('Use valid dates.')
        return tx`insert into university_intakes (university_id, course_id, name, application_deadline, starts_on)
                  values (${universityId}, ${v.courseId || null}, ${v.name.trim()}, ${v.applicationDeadline ?? null}, ${v.startsOn ?? null})`
      case 'requirement':
        if (!v.documentTypeId) throw invalid('Choose a document type.')
        {
          const conditions = conditionsFromForm(v.conditions)
          return tx`insert into university_document_requirements (university_id, course_id, document_type_id, is_required, notes, conditions)
                  values (${universityId}, ${v.courseId || null}, ${v.documentTypeId}, ${v.required !== 'no'}, ${v.notes ?? null}, ${conditions ? tx.json(conditions as never) : null})`
        }
    }
  })
}

const PART_TABLE: Record<Exclude<Part, 'requirement'>, string> = { campus: 'university_campuses', course: 'university_courses', intake: 'university_intakes' }

export async function setUniversityPartActive(ctx: Ctx, part: Exclude<Part, 'requirement'>, id: string, active: boolean) {
  guard(ctx)
  return run(ctx, async (tx) => {
    const r = await tx`update ${tx(PART_TABLE[part])} set is_active = ${active} where id = ${id}`
    if (!r.count) throw notFound()
  })
}

/** Removing a requirement affects only future checklists; existing student checklist items are kept. */
export async function removeRequirement(ctx: Ctx, id: string) {
  guard(ctx)
  return run(ctx, async (tx) => {
    const r = await tx`delete from university_document_requirements where id = ${id}`
    if (!r.count) throw notFound()
  })
}
