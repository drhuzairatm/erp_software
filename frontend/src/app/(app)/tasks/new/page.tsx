import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui'
import { can, orgsWith } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { taskAssignees } from '@/services/tasks'
import { NewTaskForm } from '../task-forms'

export const metadata: Metadata = { title: 'New task' }

export default async function NewTaskPage() {
  const ctx = await requireUser()
  const orgIds = orgsWith(ctx, 'tasks.create')
  if (!orgIds.length) return <PageHeader title="New task" description="You cannot create tasks." />
  const staff = await taskAssignees(ctx, orgIds)
  return (
    <>
      <PageHeader title="New task" description="For a task about a specific student, create it from the student's Tasks tab." back={{ href: '/tasks', label: 'Tasks' }} />
      <div className="card max-w-3xl p-6">
        <NewTaskForm orgs={orgIds.map((id) => ({ id, name: ctx.memberships.find((m) => m.orgId === id)!.orgName }))} staff={staff}
          assignOrgs={orgIds.filter((o) => can(ctx, 'tasks.assign', o))} me={ctx.userId} />
      </div>
    </>
  )
}
