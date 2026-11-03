import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { canSeeMasterData, masterDataPermissions } from '@/services/master-data'

export const metadata: Metadata = { title: 'Master data permissions' }

const LABEL: Record<string, string> = {
  'masterdata.view': 'View', 'countries.manage': 'Countries', 'universities.manage': 'Universities', 'courses.manage': 'Courses', 'masterdata.status': 'Activate / deactivate',
  'requirements.manage': 'Country requirements', 'workflow.manage': 'Workflows', 'attestation.routes.manage': 'Attestation routes',
  'verification.rules.manage': 'Verification / Bonafide rules', 'academic.rules.manage': 'Academic & name rules', 'passport.rules.manage': 'Passport & contact rules',
}

export default async function PermissionsPage() {
  const ctx = await requireUser()
  if (!canSeeMasterData(ctx)) return <PageHeader title="Master data permissions" description="You do not have access to master data." />
  const rows = await masterDataPermissions(ctx)
  return (
    <>
      <PageHeader title="Master Data User Permissions" description="Who may view or change master data, by role. Only the MD by default." />
      <Card padded={false}>
        <div className="table-wrap"><table>
          <thead><tr><th>Company</th><th>Role</th><th>Master-data permissions</th><th>People</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.role_id}><td>{r.org_name}</td><td className="font-medium">{r.role_name}{r.is_protected && <div className="text-xs text-slate-500">locked – all permissions</div>}</td>
              <td className="text-xs">{r.perms.map((p) => LABEL[p] ?? p).join(', ')}</td><td className="text-xs">{r.people.join(', ') || '—'}</td></tr>))}
          </tbody>
        </table></div>
        <p className="hint px-4 pb-3">To delegate or revoke, the MD edits the role under <Link href="/admin/roles">Roles &amp; permissions</Link> (category &quot;Master data&quot;).
          Nobody can grant permissions they do not hold or change a role they hold; all changes are audited.</p>
      </Card>
    </>
  )
}
