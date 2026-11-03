'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import type { ActionResult } from '@/components/action-types'
import { acceptInvitation, changeOwnPassword, completePasswordReset, requestPasswordReset } from '@/lib/auth/passwords'
import { deliverStaffEmails } from '@/lib/auth/staff-email'
import { newDeviceToken, setDeviceCookie, STAFF_DEVICE_COOKIE, trustStaffBrowserAfterMfa } from '@/lib/auth/trusted-device'
import { revokeSessions } from '@/services/admin'
import { adminResetMfa, finishEnrolment, startEnrolment, verifyLoginCode } from '@/lib/auth/mfa-service'
import { getPendingMfaToken, login, logout, requireUser } from '@/lib/auth/session'
import { emailConfigured } from '@/lib/email'
import { formObject, passwordChangeSchema, fieldErrors } from '@/lib/validation'
import { runAction } from './run-action'

export async function loginAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const { email, password } = formObject(fd)
  if (!email || !password) return { ok: false, message: 'Enter your email and password.' }
  const r = await login(email.slice(0, 200), String(fd.get('password') ?? '').slice(0, 200))
  if (!r.ok) return { ok: false, message: r.message }
  if (r.mfaPending) redirect('/login/verify')
  redirect(r.mustChangePassword ? '/account/password?required=1' : '/')
}

export async function logoutAction() {
  await logout()
  redirect('/login')
}

export async function forgotPasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const { email } = formObject(fd)
  if (!email) return { ok: false, message: 'Enter your email address.' }
  await requestPasswordReset(email)
  // Faster delivery only: the scheduled sender (every minute) delivers anything still queued.
  after(() => deliverStaffEmails(10).then(() => undefined, () => undefined))
  return {
    ok: true,
    message: emailConfigured()
      ? 'If an account exists for that address, a reset link has been sent. It is valid for 1 hour.'
      : 'Your request has been recorded. Email delivery is not set up yet, so please ask your administrator for a reset link.',
  }
}

export async function resetPasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const token = String(fd.get('token') ?? '')
  return runAction(async () => {
    const device = newDeviceToken()
    await completePasswordReset(token, String(fd.get('password') ?? ''), String(fd.get('confirm') ?? ''), device.hash)
    // recovery on a new device: this browser is now trusted (two-step login is still required to sign in)
    setDeviceCookie(await cookies(), STAFF_DEVICE_COOKIE, device.token, '/')
    redirect('/login?reset=1')
  })
}

export async function changePasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser({ allowPasswordChange: true })
  const parsed = passwordChangeSchema.safeParse({ current: fd.get('current'), next: fd.get('next'), confirm: fd.get('confirm') })
  if (!parsed.success) return { ok: false, message: 'Please correct the highlighted fields.', fieldErrors: fieldErrors(parsed.error) }
  return runAction(async () => {
    await changeOwnPassword(ctx.userId, ctx.sessionId, ctx.email, parsed.data.current, parsed.data.next)
    redirect('/?password=changed')
  })
}

export async function verifyMfaAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const tokenHash = await getPendingMfaToken()
  if (!tokenHash) redirect('/login')
  const r = await verifyLoginCode(tokenHash, String(fd.get('code') ?? '').slice(0, 20))
  if (!r.ok) {
    if (r.locked) { await logout(); redirect('/login?mfa=locked') }
    return { ok: false, message: r.message }
  }
  // only now (password AND two-step code accepted) may this browser become trusted
  await trustStaffBrowserAfterMfa(tokenHash).catch(() => null)
  redirect('/')
}

export async function startMfaAction(_: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser({ allowMfaSetup: true })
  return runAction(async () => ({ ok: true, data: await startEnrolment(ctx, ctx.email) }))
}

export async function finishMfaAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser({ allowMfaSetup: true })
  return runAction(async () => ({ ok: true, message: 'Two-factor login is now on.', data: { codes: await finishEnrolment(ctx, String(fd.get('code') ?? '')) } }))
}

export async function adminResetMfaAction(userId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await adminResetMfa(ctx, userId, String(fd.get('reason') ?? '')) }, 'Two-factor login reset. The person must set it up again at their next sign-in; their sessions were ended.')
}

export async function acceptInvitationAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const token = String(fd.get('token') ?? '')
  return runAction(async () => {
    await acceptInvitation(token, String(fd.get('password') ?? ''), String(fd.get('confirm') ?? ''))
    redirect('/login?invited=1')
  })
}

/** Sign out of every device, including this one. */
export async function signOutEverywhereAction(_: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser({ allowMfaSetup: true, allowPasswordChange: true })
  return runAction(async () => {
    await revokeSessions(ctx, ctx.userId)
    await logout()
    redirect('/login?signedout=all')
  })
}
