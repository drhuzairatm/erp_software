import type { Metadata } from 'next'
import { fmtDateTime, label } from '@/components/format'
import { ProfileCompletion } from '@/components/profile-completion'
import { SecureFilesCard } from '@/components/secure-files'
import { Avatar, Card, DL, PageHeader, staffPhotoUrl } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { getMyProfile } from '@/services/admin'
import { StaffPhotoForm } from '../../admin/admin-forms'
import { MyProfileForm } from './profile-form'

export const metadata: Metadata = { title: 'My profile' }

export default async function MyProfilePage() {
  const ctx = await requireUser()
  const { user: u, memberships, history, completion } = await getMyProfile(ctx)
  return (
    <>
      <PageHeader title="My profile" description="You can change your personal details here. Your email, employee ID, designation and role are managed by an administrator." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Profile photo">
          <div className="flex justify-center"><Avatar name={u.full_name} size="xl" src={staffPhotoUrl(u.id, u.photo_version)} /></div>
          <div className="mt-4 border-t border-slate-100 pt-4"><StaffPhotoForm userId={u.id} hasPhoto={!!u.photo_version} /></div>
        </Card>
        <div className="space-y-6 xl:col-span-2">
          <ProfileCompletion completion={completion} />
          <Card title="Work details">
            <DL items={[['Employee ID', <span key="e" className="font-mono">{u.employee_id}</span>], ['Email', u.email], ['Designation', u.job_title], ...memberships.map((m): [string, string] =>
              [`${m.org_name}`, `${m.role_name}${m.designation ? ` · ${m.designation}` : ''}${m.department ? ` · ${m.department}` : ''}`])]} />
          </Card>
          <Card title="Personal details"><MyProfileForm v={u} /></Card>
          <SecureFilesCard ctx={ctx} title="My documents" contextType="employee" contextId={u.id} path="/account/profile" />
          <Card title="Change history">
            {history.length === 0 ? <p className="hint">No changes recorded.</p> : <ul className="divide-y divide-slate-100 text-sm">{history.map((h, i) => (
              <li key={i} className="py-2"><span className="font-medium">{h.fields?.length ? h.fields.map((f) => label(f)).join(', ') : label(h.action)}</span>
                <span className="block text-xs text-slate-500">{fmtDateTime(h.occurred_at)}{h.actor ? ` by ${h.actor}` : ''}</span></li>))}</ul>}
          </Card>
        </div>
      </div>
    </>
  )
}
