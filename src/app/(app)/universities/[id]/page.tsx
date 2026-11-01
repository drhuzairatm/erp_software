import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { fmtDate } from '@/components/format'
import { Icon } from '@/components/icons'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { getLookups } from '@/server/services/lookups'
import { canManageUniversities, getUniversity } from '@/server/services/universities'
import { AddCampusForm, AddCourseForm, AddIntakeForm, AddRequirementForm, RemoveRequirement, TogglePart, UniversityForm } from '../university-forms'

export const metadata: Metadata = { title: 'University' }

export default async function UniversityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireUser()
  const [data, lookups] = await Promise.all([getUniversity(ctx, id), getLookups(ctx)])
  if (!data) notFound()
  const { university: u } = data
  const manage = canManageUniversities(ctx)
  const courseOpts = lookups.courses.map((c) => ({ value: c.id, label: c.name }))
  return (
    <>
      <PageHeader title={u.name} back={{ href: '/universities', label: 'Universities' }}
        description={<>{u.country}{u.city ? ` · ${u.city}` : ''}{u.website && <> · <a href={u.website} target="_blank" rel="noopener noreferrer">{u.website}</a></>} {!u.is_active && <Badge>Deactivated</Badge>}</>} />
      <section aria-label="University overview" className="relative mb-6 overflow-hidden rounded-2xl bg-hero p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <span aria-hidden className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-cyan-brand ring-1 ring-white/15"><Icon name="university" className="h-8 w-8" /></span>
          <dl className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
            {([['Courses', data.courses.filter((c) => c.is_active).length], ['Intakes', data.intakes.filter((i) => i.is_active).length],
               ['Required documents', data.requirements.length], ['Campuses', data.campuses.filter((c) => c.is_active).length]] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10"><dt className="text-xs text-slate-300">{k}</dt><dd className="text-2xl font-bold tabular-nums">{v}</dd></div>))}
          </dl>
        </div>
      </section>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Courses offered and admission requirements" padded={false}>
          {data.courses.length === 0 ? <EmptyState title="No courses yet" /> : (
            <ul className="divide-y divide-slate-100">{data.courses.map((c) => (
              <li key={c.id} className={`flex items-start justify-between gap-2 p-4 text-sm ${c.is_active ? '' : 'opacity-60'}`}>
                <div><p className="font-medium">{c.course}{c.duration_years && ` · ${Number(c.duration_years)} years`}{c.medium && ` · ${c.medium} medium`}</p>
                  {c.eligibility && <p className="mt-1 whitespace-pre-wrap text-slate-700">{c.eligibility}</p>}</div>
                {manage && <TogglePart universityId={u.id} part="course" id={c.id} active={c.is_active} />}
              </li>))}
            </ul>
          )}
          {manage && <div className="border-t border-slate-100 p-4"><AddCourseForm universityId={u.id} courses={courseOpts} /></div>}
        </Card>
        <Card title="Intakes and deadlines" padded={false}>
          {data.intakes.length === 0 ? <EmptyState title="No intakes yet" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Intake</th><th>Course</th><th>Apply by</th><th>Starts</th><th></th></tr></thead>
              <tbody>{data.intakes.map((i) => (
                <tr key={i.id} className={i.is_active ? '' : 'opacity-60'}>
                  <td>{i.name}</td><td>{i.course ?? 'All'}</td><td>{fmtDate(i.application_deadline)}</td><td>{fmtDate(i.starts_on)}</td>
                  <td className="text-right">{manage && <TogglePart universityId={u.id} part="intake" id={i.id} active={i.is_active} />}</td>
                </tr>))}
              </tbody>
            </table></div>
          )}
          {manage && <div className="border-t border-slate-100 p-4"><AddIntakeForm universityId={u.id} courses={courseOpts} /></div>}
        </Card>
        <Card title="Required documents for this university" padded={false}>
          <p className="px-4 pt-3 text-xs text-slate-500">Added automatically to the checklist of every student assigned to this university (course-specific ones only for that course).</p>
          {data.requirements.length === 0 ? <EmptyState title="No university-specific documents" /> : (
            <ul className="divide-y divide-slate-100">{data.requirements.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span>{r.document} {!r.is_required && <Badge>Optional</Badge>} <span className="text-xs text-slate-500">{r.course ? `· ${r.course} only` : '· all courses'}{r.notes ? ` · ${r.notes}` : ''}</span></span>
                {manage && <RemoveRequirement universityId={u.id} id={r.id} />}
              </li>))}
            </ul>
          )}
          {manage && <div className="border-t border-slate-100 p-4"><AddRequirementForm universityId={u.id} courses={courseOpts} documentTypes={lookups.documentTypes.map((d) => ({ value: d.id, label: d.name }))} /></div>}
        </Card>
        <Card title="Campuses" padded={false}>
          {data.campuses.length === 0 ? <EmptyState title="No campuses recorded" /> : (
            <ul className="divide-y divide-slate-100">{data.campuses.map((c) => (
              <li key={c.id} className={`flex items-center justify-between px-4 py-2 text-sm ${c.is_active ? '' : 'opacity-60'}`}>
                <span>{c.name}{c.city && <span className="text-slate-500"> · {c.city}</span>}</span>
                {manage && <TogglePart universityId={u.id} part="campus" id={c.id} active={c.is_active} />}
              </li>))}
            </ul>
          )}
          {manage && <div className="border-t border-slate-100 p-4"><AddCampusForm universityId={u.id} /></div>}
        </Card>
        {manage && (
          <Card title="Details" className="xl:col-span-2">
            <UniversityForm id={u.id} countries={[]} initial={u} />
          </Card>
        )}
        {!manage && u.notes && <Card title="Notes"><p className="whitespace-pre-wrap text-sm">{u.notes}</p></Card>}
      </div>
    </>
  )
}
