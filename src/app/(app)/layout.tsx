import Link from 'next/link'
import { logoutAction } from '@/app/actions/auth'
import { setScopeAction } from '@/app/actions/scope'
import { BrandMark } from '@/components/brand-mark'
import { Icon } from '@/components/icons'
import { BRANDS, brandOf } from '@/lib/brands'
import { can, canAny } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { getNotifications } from '@/server/services/dashboard'
import { getScope } from '@/server/scope'
import { type NavItem, ScopeSelect, Sidebar } from './nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser({ allowPasswordChange: true, allowMfaSetup: true })
  const scope = await getScope(ctx)
  const notifications = ctx.memberships.length ? await getNotifications(ctx) : { items: [], total: 0 }
  const current = scope.isAll ? null : ctx.memberships.find((m) => m.orgId === scope.orgIds[0])
  const brand = brandOf(current?.orgCode ?? (ctx.memberships.length === 1 ? ctx.memberships[0].orgCode : null))

  const items: NavItem[] = []
  const add = (group: string, href: string, label: string, icon: string) => items.push({ group, href, label, icon })
  if (can(ctx, 'dashboard.view')) add('Workspace', '/', 'Dashboard', 'dashboard')
  if (canAny(ctx, ['students.read.all', 'students.read.processing', 'students.read.assigned'])) add('Workspace', '/students', 'Students', 'students')
  if (canAny(ctx, ['tasks.read.all', 'tasks.read.own'])) add('Workspace', '/tasks', 'Tasks', 'tasks')
  if (ctx.memberships.length) add('Workspace', '/universities', 'Universities', 'university')
  if (can(ctx, 'payments.read')) add('Finance', '/payments', 'Payment ledger', 'payments')
  if (can(ctx, 'reports.view')) add('Insights', '/reports', 'Reports', 'reports')
  if (can(ctx, 'notifications.view')) add('Insights', '/notifications', 'Messages', 'messages')
  if (can(ctx, 'users.manage')) add('Administration', '/admin/users', 'Staff', 'staff')
  if (can(ctx, 'roles.manage')) add('Administration', '/admin/roles', 'Roles & permissions', 'shield')
  if (canAny(ctx, ['settings.manage', 'reference.manage', 'workflow.manage', 'departments.manage'])) add('Administration', '/admin/settings', 'Company settings', 'settings')
  if (can(ctx, 'settings.manage')) add('Administration', '/admin/courier', 'Courier addresses', 'truck')
  if (canAny(ctx, ['requirements.manage'])) add('Rules & compliance', '/admin/requirements', 'Country-wise requirements', 'globe')
  if (canAny(ctx, ['academic.rules.manage', 'one_and_same.templates.approve'])) add('Rules & compliance', '/admin/academic-rules', 'Academic & name rules', 'book')
  if (canAny(ctx, ['passport.rules.manage'])) add('Rules & compliance', '/admin/passport-rules', 'Passport & contact rules', 'passport')
  if (canAny(ctx, ['attestation.routes.manage', 'attestation.routes.approve'])) add('Rules & compliance', '/admin/attestation-routes', 'Attestation routes', 'stamp')
  if (canAny(ctx, ['verification.rules.manage', 'verification.rules.approve'])) add('Rules & compliance', '/admin/verification-rules', 'Verification rules', 'rules')
  if (canAny(ctx, ['verification.rules.manage', 'verification.rules.approve', 'attestation.routes.manage', 'attestation.routes.approve', 'passport.rules.manage', 'academic.rules.manage', 'universities.manage'])) add('Rules & compliance', '/admin/rule-tester', 'Rule tester', 'check')
  if (can(ctx, 'notifications.manage')) add('Administration', '/admin/notifications', 'Notification settings', 'bell')
  if (can(ctx, 'audit.read')) add('Administration', '/audit', 'Audit log', 'audit')

  const scopeOptions = [
    ...(ctx.memberships.length > 1 ? [{ value: 'all', label: 'All my companies' }] : []),
    ...ctx.memberships.map((m) => ({ value: m.orgId, label: m.orgName })),
  ]
  const roleSummary = ctx.memberships.map((m) => `${m.roleName}${m.departmentName ? ` (${m.departmentName})` : ''} · ${m.orgCode}`).join(', ')
  const initials = ctx.fullName.replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

  return (
    <div data-brand={brand} className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <Sidebar items={items}
        header={<>
          <Link href="/" className="block no-underline hover:no-underline"><BrandMark brand={brand} /></Link>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-400">{BRANDS[brand].tagline}</p>
          {scopeOptions.length > 0 && (
            <form action={setScopeAction} className="mt-4"><ScopeSelect options={scopeOptions} value={scope.isAll ? 'all' : scope.orgIds[0]} /></form>
          )}
        </>}
        footer={<span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-teal-brand shadow-[0_0_8px_#24E0B8]" aria-hidden />Staff portal · secure session</span>} />

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
          <div className="flex items-center gap-3 px-4 py-2.5 pl-16 lg:px-8 lg:pl-8">
            {canAny(ctx, ['students.read.all', 'students.read.processing', 'students.read.assigned']) && (
              <form action="/students" role="search" className="relative hidden max-w-md flex-1 sm:block">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <label htmlFor="global-search" className="sr-only">Search students</label>
                <input id="global-search" name="q" placeholder="Search students by name, ID, phone or passport…"
                  className="w-full rounded-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm placeholder:text-slate-400 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100" />
              </form>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100" aria-label={`Notifications: ${notifications.total}`}>
                  <Icon name="bell" className="h-5 w-5" /><span className="hidden sm:inline">Alerts</span>
                  {notifications.total > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{notifications.total}</span>}
                </summary>
                <div className="card absolute right-0 z-30 mt-2 w-80 p-2 text-sm">
                  <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Needs your attention</p>
                  {notifications.items.length === 0 ? <p className="p-2 text-slate-500">Nothing needs your attention right now.</p> : (
                    <ul>{notifications.items.map((n) => (
                      <li key={n.key}><Link className="flex justify-between rounded-lg px-2 py-2 text-slate-700 no-underline hover:bg-slate-50" href={n.href}><span>{n.label}</span><span className="font-semibold">{n.count}</span></Link></li>))}
                    </ul>
                  )}
                </div>
              </details>
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-teal-brand text-xs font-bold text-white">{initials}</span>
                  <span className="hidden max-w-40 truncate md:inline">{ctx.fullName}</span>
                </summary>
                <div className="card absolute right-0 z-30 mt-2 w-72 p-4 text-sm">
                  <p className="font-semibold">{ctx.fullName}</p>
                  <p className="text-slate-500">{ctx.email}</p>
                  <p className="mt-1 text-xs text-slate-500">{roleSummary || 'No company access'}</p>
                  <div className="mt-3 grid gap-1.5">
                    <Link href="/account/password" className="btn-secondary btn-sm justify-start"><Icon name="key" className="h-4 w-4" />Change password</Link>
                    <Link href="/account/security" className="btn-secondary btn-sm justify-start"><Icon name="shield" className="h-4 w-4" />Two-factor login{ctx.mfaEnabled ? ' ✓' : ''}</Link>
                    <form action={logoutAction}><button className="btn-secondary btn-sm w-full justify-start" type="submit"><Icon name="logout" className="h-4 w-4" />Sign out</button></form>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">
          {ctx.mfaSetupRequired && (
            <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
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
