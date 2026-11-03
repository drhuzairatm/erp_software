import type { Metadata } from 'next'
import Link from 'next/link'
import { Icon } from '@/components/icons'
import { Alert, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { canSeeMasterData } from '@/services/master-data'

export const metadata: Metadata = { title: 'Master data' }

const CARDS: [string, string, string, string][] = [
  ['/admin/master-data/countries', 'Country Management', 'Add, edit, activate/deactivate countries; nationality, indicative currency, notes; universities per country.', 'globe'],
  ['/universities', 'University Management', 'Universities by country: website, courses offered, intakes and deadlines, documents, campuses, notes.', 'university'],
  ['/admin/master-data/courses', 'Course Management', 'Courses and specialisations, categories, duration, eligibility, countries and universities offering them.', 'book'],
  ['/admin/requirements', 'Country Requirements', 'Advisory country-wise requirements (academic marks etc.) with acknowledgement – never blocking.', 'flag'],
  ['/universities', 'University Requirements', 'Each university page: required documents (with conditions), course eligibility, intakes.', 'doc'],
  ['/admin/requirements', 'Course Requirements', 'Requirements can target a course (and university) in Country Requirements; course eligibility on the course.', 'rules'],
  ['/admin/settings', 'Admission Workflow Configuration', 'Workflows per country/course: stages and required documents (Company settings → Workflows).', 'tasks'],
  ['/admin/verification-rules', 'Document & Attestation Configuration', 'Verification and Bonafide rules, attestation/apostille routes, passport and academic rules.', 'stamp'],
  ['/admin/master-data/permissions', 'Master Data User Permissions', 'Who may change master data. Only the MD by default; delegate under Roles.', 'shield'],
  ['/admin/master-data/history', 'Master Data Audit History', 'Every change to countries, universities, courses, requirements, workflows and permissions.', 'audit'],
]

export default async function MasterDataPage() {
  const ctx = await requireUser()
  if (!canSeeMasterData(ctx)) return <PageHeader title="Master data" description="You do not have access to master data. Missing a country, university or course? Ask for it under Requests." />
  return (
    <>
      <PageHeader title="Master data" description="Countries, universities, courses and their admission configuration. Controlled by the Managing Director." />
      <div className="mb-5"><Alert tone="blue">Only the MD can change master data unless the MD delegates specific permissions (Roles). Records are never deleted – deactivated
        records are no longer offered for new applications, and existing students keep their original selection.</Alert></div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CARDS.map(([href, title, text, icon], i) => (
          <Link key={i} href={href} className="card group flex gap-3 p-5 text-slate-900 no-underline transition hover:-translate-y-0.5 hover:no-underline hover:shadow-md">
            <span aria-hidden className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-950 text-cyan-brand"><Icon name={icon} className="h-5 w-5" /></span>
            <span><span className="block font-semibold group-hover:text-brand-700">{i + 1}. {title}</span><span className="mt-1 block text-sm text-slate-600">{text}</span></span>
          </Link>))}
      </div>
    </>
  )
}
