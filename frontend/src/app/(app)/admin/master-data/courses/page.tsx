import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { canSeeMasterData, listCountries, listCourses, mdCan } from '@/server/services/master-data'
import { CourseForm, StatusButton } from '../forms'

export const metadata: Metadata = { title: 'Courses' }

export default async function CoursesPage() {
  const ctx = await requireUser()
  if (!canSeeMasterData(ctx)) return <PageHeader title="Courses" description="You do not have access to master data." />
  const [rows, countries] = await Promise.all([listCourses(ctx), listCountries(ctx)])
  const edit = mdCan(ctx, 'courses.manage'); const status = mdCan(ctx, 'masterdata.status')
  const categories = [...new Set(['MBBS', 'Nursing', 'Postgraduate Medical', ...rows.map((r) => r.category)])]
  const courseOpts = rows.filter((r) => r.is_active).map((r) => ({ value: r.id, label: r.name }))
  const countryOpts = countries.filter((c) => c.is_active && c.is_destination).map((c) => ({ value: c.id, label: c.name }))
  return (
    <>
      <PageHeader title="Course Management" description="Courses and specialisations. Which universities offer a course (with duration and eligibility per university) is set on each university page." />
      {edit && <Card title="Add a course or specialisation" className="mb-5"><CourseForm c={null} courses={courseOpts} countries={countryOpts} categories={categories} /></Card>}
      <div className="space-y-3">
        {rows.map((c) => (
          <Card key={c.id} title={<span className="flex flex-wrap items-center gap-2">{c.name}<span className="rounded-full bg-slate-100 px-2 text-xs font-medium text-slate-600">{c.category}</span>
            {c.parent && <span className="text-xs font-normal text-slate-500">specialisation of {c.parent}</span>}{!c.is_active && <Badge>Inactive</Badge>}</span>}
            actions={status && <StatusButton kind="course" id={c.id} active={c.is_active} label={c.name} />}>
            <p className="mb-3 text-sm text-slate-600">{c.students} active students · offered by {c.universities.length ? c.universities.map((u, i) => <span key={u.id}>{i > 0 && ', '}<Link href={`/universities/${u.id}`}>{u.name}</Link> ({u.country})</span>) : 'no university yet'}</p>
            {edit && <CourseForm c={c} courses={courseOpts} countries={countryOpts} categories={categories} />}
          </Card>))}
      </div>
    </>
  )
}
