import type { Metadata } from 'next'
import { contactRequiredStage } from '@/server/services/passport'
import { noticesByCountry } from '@/server/services/requirements'
import { createStudentAction } from '@/app/actions/students'
import { PageHeader } from '@/components/ui'
import { can, orgsWith } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { getLookups, staffOf } from '@/server/services/lookups'
import { run } from '@/server/services/base'
import { getScope } from '@/server/scope'
import { todayISO } from '@/components/format'
import { StudentForm } from '../student-form'

export const metadata: Metadata = { title: 'Register student' }

export default async function NewStudentPage() {
  const ctx = await requireUser()
  const scope = await getScope(ctx)
  const allowed = orgsWith(ctx, 'students.create')
  if (!allowed.length) return <PageHeader title="Register student" description="You do not have permission to register students." />
  const ordered = [...allowed].sort((a, b) => Number(scope.orgIds[0] === b) - Number(scope.orgIds[0] === a))
  const lookups = await getLookups(ctx)
  const assignOrgs = ordered.filter((o) => can(ctx, 'students.assign', o))
  const counsellors = assignOrgs.length
    ? (await run(ctx, (tx) => staffOf(tx, assignOrgs))).filter((s) => s.perms.includes('stage.sales')).map((s) => ({ id: s.id, name: `${s.full_name} (${s.role_name})`, org_id: s.org_id }))
    : []
  return (
    <>
      <PageHeader title="Register student" description="Only collect what is needed. A Student ID is generated automatically." back={{ href: '/students', label: 'Students' }} />
      <StudentForm contactRequiredFrom={(await contactRequiredStage(ctx))?.name} countryNotices={await noticesByCountry(ctx)} action={createStudentAction} mode="create" cancelHref="/students" contactEditable
        passportEditable={ordered.some((o) => can(ctx, 'students.passport.view', o))}
        canRecordConsent={ordered.some((o) => can(ctx, 'notifications.consent', o))}
        registerOrgs={ordered.map((id) => ({ id, name: ctx.memberships.find((m) => m.orgId === id)!.orgName }))}
        organizations={lookups.organizations} lookups={lookups} counsellors={counsellors}
        initial={{ originatingOrgId: ordered[0], registrationDate: todayISO() }} />
    </>
  )
}
