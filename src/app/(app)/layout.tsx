import Link from 'next/link'
import { logoutAction } from '@/app/actions/auth'
import { setScopeAction } from '@/app/actions/scope'
import { can, canAny } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { getNotifications } from '@/server/services/dashboard'
import { getScope } from '@/server/scope'
import { Nav, type NavItem, ScopeSelect } from './nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser({ allowPasswordChange: true, allowMfaSetup: true })
  const scope = await getScope(ctx)
  const notifications = ctx.memberships.length ? await getNotifications(ctx) : { items: [], total: 0 }

  const items: NavItem[] = []
  if (can(ctx, 'dashboard.view')) items.push({ href: '/', label: 'Dashboard' })
  if (canAny(ctx, ['students.read.all', 'students.read.processing', 'students.read.assigned'])) items.push({ href: '/students', label: 'Students' })
  if (canAny(ctx, ['tasks.read.all', 'tasks.read.own'])) items.push({ href: '/tasks', label: 'Tasks' })
  if (ctx.memberships.length) items.push({ href: '/universities', label: 'Universities' })
  if (can(ctx, 'payments.read')) items.push({ href: '/payments', label: 'Payment ledger' })
  if (can(ctx, 'reports.view')) items.push({ href: '/reports', label: 'Reports' })
  if (can(ctx, 'notifications.view')) items.push({ href: '/notifications', label: 'Messages' })
  if (can(ctx, 'notifications.manage')) items.push({ href: '/admin/notifications', label: 'Notification settings' })
  if (can(ctx, 'users.manage')) items.push({ href: '/admin/users', label: 'Staff' })
  if (can(ctx, 'roles.manage')) items.push({ href: '/admin/roles', label: 'Roles & permissions' })
  if (canAny(ctx, ['settings.manage', 'reference.manage', 'workflow.manage', 'departments.manage'])) items.push({ href: '/admin/settings', label: 'Company settings' })
  if (canAny(ctx, ['requirements.manage'])) items.push({ href: '/admin/requirements', label: 'Country-wise requirements' })
  if (canAny(ctx, ['academic.rules.manage', 'one_and_same.templates.approve'])) items.push({ href: '/admin/academic-rules', label: 'Academic & name rules' })
  if (canAny(ctx, ['passport.rules.manage'])) items.push({ href: '/admin/passport-rules', label: 'Passport & contact rules' })
  if (canAny(ctx, ['attestation.routes.manage', 'attestation.routes.approve'])) items.push({ href: '/admin/attestation-routes', label: 'Attestation routes' })
  if (canAny(ctx, ['verification.rules.manage', 'verification.rules.approve'])) items.push({ href: '/admin/verification-rules', label: 'Verification rules' })
  if (can(ctx, 'audit.read')) items.push({ href: '/audit', label: 'Audit log' })

  const scopeOptions = [
    ...(ctx.memberships.length > 1 ? [{ value: 'all', label: 'All my companies' }] : []),
    ...ctx.memberships.map((m) => ({ value: m.orgId, label: m.orgName })),
  ]
  const roleSummary = ctx.memberships.map((m) => `${m.roleName}${m.departmentName ? ` (${m.departmentName})` : ''} · ${m.orgCode}`).join(', ')

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-4">
          <Link href="/" className="no-underline hover:no-underline">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Staff Portal</p>
            <p className="text-sm font-semibold text-slate-900">Edulinks · GRADUATER</p>
          </Link>
        </div>
        {scopeOptions.length > 0 && (
          <form action={setScopeAction} className="px-4 pb-3">
            <ScopeSelect options={scopeOptions} value={scope.isAll ? 'all' : scope.orgIds[0]} />
          </form>
        )}
        <details className="group lg:hidden" >
          <summary className="cursor-pointer list-none px-4 pb-3 text-sm font-medium text-slate-700">☰ Menu</summary>
          <nav aria-label="Main" className="px-2 pb-3"><Nav items={items} /></nav>
        </details>
        <nav aria-label="Main" className="hidden px-2 pb-6 lg:block"><Nav items={items} /></nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 py-2.5 lg:px-8">
          <details className="relative">
            <summary className="btn-ghost btn-sm cursor-pointer list-none" aria-label={`Notifications: ${notifications.total}`}>
              Alerts {notifications.total > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{notifications.total}</span>}
            </summary>
            <div className="card absolute right-0 z-20 mt-2 w-80 p-2 text-sm">
              {notifications.items.length === 0 ? <p className="p-2 text-slate-500">Nothing needs your attention right now.</p> : (
                <ul>
                  {notifications.items.map((n) => (
                    <li key={n.key}><Link className="flex justify-between rounded px-2 py-2 hover:bg-slate-50" href={n.href}><span>{n.label}</span><span className="font-semibold">{n.count}</span></Link></li>
                  ))}
                </ul>
              )}
            </div>
          </details>
          <details className="relative">
            <summary className="btn-ghost btn-sm cursor-pointer list-none">{ctx.fullName}</summary>
            <div className="card absolute right-0 z-20 mt-2 w-72 p-3 text-sm">
              <p className="font-medium">{ctx.fullName}</p>
              <p className="text-slate-500">{ctx.email}</p>
              <p className="mt-1 text-xs text-slate-500">{roleSummary || 'No company access'}</p>
              <div className="mt-3 flex gap-2">
                <Link href="/account/password" className="btn-secondary btn-sm">Change password</Link>
                <Link href="/account/security" className="btn-secondary btn-sm">2FA{ctx.mfaEnabled ? ' ✓' : ''}</Link>
                <form action={logoutAction}><button className="btn-secondary btn-sm" type="submit">Sign out</button></form>
              </div>
            </div>
          </details>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
          {ctx.mfaSetupRequired && (
            <p role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              Two-factor login is required for your role. <Link href="/account/security?required=1">Set it up now</Link> to continue.
            </p>
          )}
          {ctx.memberships.length === 0 ? (
            <div className="card p-6">
              <h1 className="text-lg font-semibold">No company access</h1>
              <p className="mt-1 text-sm text-slate-600">Your account is not an active member of any company. Ask an administrator to add you.</p>
            </div>
          ) : children}
        </main>
      </div>
    </div>
  )
}
