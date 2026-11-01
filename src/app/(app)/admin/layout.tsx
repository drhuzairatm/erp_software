import { can, canAny } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { canTestRules } from '@/server/services/rules'
import { canSeeMasterData } from '@/server/services/master-data'
import { type AdminSection, AdminTabs } from './admin-tabs'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser()
  const s: AdminSection[] = []
  const add = (ok: boolean, group: string, href: string, label: string, icon: string) => { if (ok) s.push({ group, href, label, icon }) }
  add(can(ctx, 'users.manage'), 'Administration', '/admin/users', 'Staff', 'staff')
  add(can(ctx, 'roles.manage'), 'Administration', '/admin/roles', 'Roles', 'shield')
  add(canAny(ctx, ['settings.manage', 'reference.manage', 'workflow.manage', 'departments.manage']), 'Administration', '/admin/settings', 'Company settings', 'settings')
  add(can(ctx, 'settings.manage'), 'Administration', '/admin/courier', 'Courier addresses', 'truck')
  add(can(ctx, 'notifications.manage'), 'Administration', '/admin/notifications', 'Notifications', 'bell')
  add(can(ctx, 'currencies.manage'), 'Administration', '/admin/currencies', 'Currencies', 'wallet')
  add(canSeeMasterData(ctx), 'Rules', '/admin/master-data', 'Master data', 'university')
  add(can(ctx, 'requirements.manage'), 'Rules', '/admin/requirements', 'Country requirements', 'globe')
  add(canAny(ctx, ['academic.rules.manage', 'one_and_same.templates.approve']), 'Rules', '/admin/academic-rules', 'Academic & names', 'book')
  add(can(ctx, 'passport.rules.manage'), 'Rules', '/admin/passport-rules', 'Passport & contact', 'passport')
  add(canAny(ctx, ['attestation.routes.manage', 'attestation.routes.approve']), 'Rules', '/admin/attestation-routes', 'Attestation', 'stamp')
  add(canAny(ctx, ['verification.rules.manage', 'verification.rules.approve']), 'Rules', '/admin/verification-rules', 'Verification', 'rules')
  add(canTestRules(ctx), 'Rules', '/admin/rule-tester', 'Rule tester', 'check')
  return <><AdminTabs sections={s} />{children}</>
}
