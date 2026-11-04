import Link from 'next/link'

const SECTIONS = [
  ['/admin/master-data', 'Overview'], ['/admin/master-data/countries', 'Countries'], ['/universities', 'Universities'], ['/admin/master-data/courses', 'Courses'],
  ['/admin/master-data/requests', 'Requests'], ['/admin/master-data/permissions', 'Permissions'], ['/admin/master-data/history', 'History'],
] as const

export default function MasterDataLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav aria-label="Master data sections" className="mb-5 flex flex-wrap gap-1.5 text-sm">
        {SECTIONS.map(([href, label]) => <Link key={href} href={href} className="inline-flex items-center rounded-full bg-white px-3 py-1 font-medium max-lg:min-h-10 text-slate-700 no-underline ring-1 ring-slate-200 hover:bg-slate-50 hover:no-underline">{label}</Link>)}
      </nav>
      {children}
    </>
  )
}
