'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireUser } from '@/server/auth/session'
import { resolveScope, SCOPE_COOKIE } from '@/server/scope'

export async function setScopeAction(fd: FormData) {
  const ctx = await requireUser()
  const value = String(fd.get('scope') ?? '')
  // validated against memberships; an invalid value falls back to the first company
  const scope = resolveScope(ctx, value)
  ;(await cookies()).set(SCOPE_COOKIE, scope.isAll ? 'all' : scope.orgIds[0], {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 90,
  })
  const back = String(fd.get('back') ?? '/')
  redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/')
}
