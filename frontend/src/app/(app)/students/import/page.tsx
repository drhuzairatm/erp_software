import type { Metadata } from 'next'
import { Alert, Card, PageHeader } from '@/components/ui'
import { can } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { getLookups } from '@/server/services/lookups'
import { getScope } from '@/server/scope'
import { IMPORT_FIELDS, MAX_IMPORT_ROWS } from '@/server/services/student-import'
import { ImportWizard } from './import-wizard'

export const metadata: Metadata = { title: 'Import students' }

export default async function ImportPage() {
  const ctx = await requireUser()
  const scope = await getScope(ctx)
  const orgs = ctx.memberships.filter((m) => can(ctx, 'students.import', m.orgId) && can(ctx, 'students.create', m.orgId))
  if (!orgs.length) {
    return <><PageHeader title="Import students" back={{ href: '/students', label: 'Students' }} /><Alert tone="amber">You do not have permission to import students. Ask a manager or administrator.</Alert></>
  }
  const lookups = await getLookups(ctx)
  const ordered = [...orgs].sort((a, b) => Number(scope.orgIds[0] === b.orgId) - Number(scope.orgIds[0] === a.orgId))
  return (
    <>
      <PageHeader title="Import students from CSV" back={{ href: '/students', label: 'Students' }}
        description={`Up to ${MAX_IMPORT_ROWS} rows per file. Nothing is saved until you review the preview and confirm.`}
        actions={<a className="btn-secondary" href="/api/students/import-template">Download template</a>} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2"><ImportWizard orgs={ordered.map((m) => ({ id: m.orgId, name: m.orgName }))} /></div>
        <Card title="How to prepare the file">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>Start from the template, or export from your spreadsheet / CRM. The first row must contain column names.</li>
            <li>Required: <strong>Full name</strong> and <strong>Phone</strong> or <strong>Email</strong>. Other columns are optional.</li>
            <li>Dates: <code>DD/MM/YYYY</code> or <code>YYYY-MM-DD</code>.</li>
            <li>
              <strong>Country</strong> and <strong>Course</strong> fill in the destination and course, which also choose the right
              workflow and document checklist. Use these names (capitals do not matter):
              <p className="mt-1"><span className="font-medium">Countries:</span> {lookups.countries.map((c) => c.name).join(', ')}</p>
              <p className="mt-1"><span className="font-medium">Courses:</span> {lookups.courses.map((c) => c.name).join(', ')}</p>
              <p className="mt-1 text-slate-500">Missing one? A system administrator can add it under Company settings. Leave the cell blank if unknown.</p>
            </li>
            <li>University and lead source must also match names set up in Company settings.</li>
            <li>Format the phone column as <em>Text</em> in Excel so numbers are not converted, then <em>Save as → CSV UTF-8</em>.</li>
            <li>Only collect data you need. Use fictional data until the system is approved for real records.</li>
          </ol>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-medium">Recognised column names</summary>
            <ul className="mt-2 space-y-1">
              {Object.values(IMPORT_FIELDS).map((f) => <li key={f.label}><strong>{f.label}</strong>: <span className="text-slate-600">{f.aliases.join(', ')}</span></li>)}
            </ul>
          </details>
        </Card>
      </div>
    </>
  )
}
