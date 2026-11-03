import 'server-only'
import { cookies } from 'next/headers'
import type { AuthContext } from './auth/context'

export const SCOPE_COOKIE = 'erp_scope'

export interface Scope {
  /** Companies whose data is shown. Always a subset of the user's memberships. */
  orgIds: string[]
  isAll: boolean
  label: string
}

/** The company the user is currently working in. Never trusted blindly: validated against memberships. */
export async function getScope(ctx: Pick<AuthContext, 'memberships'>): Promise<Scope> {
  const value = (await cookies()).get(SCOPE_COOKIE)?.value
  return resolveScope(ctx, value)
}

export function resolveScope(ctx: Pick<AuthContext, 'memberships'>, value: string | undefined): Scope {
  const ms = ctx.memberships
  if (!ms.length) return { orgIds: [], isAll: false, label: 'No company' }
  if (value === 'all' && ms.length > 1) return { orgIds: ms.map((m) => m.orgId), isAll: true, label: 'All my companies' }
  const m = ms.find((x) => x.orgId === value) ?? ms[0]
  return { orgIds: [m.orgId], isAll: false, label: m.orgName }
}
