'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { chooseStudent, markNoticesRead, portalSubmitReferral, publicSubmitReferral, passwordLogin, portalLogout, portalSubmitCourier, portalUpload, requestCode, requestPasswordReset, setPasswordWithLink, verifyCode } from '@/server/portal'
import { runAction } from '../actions/run-action'

export async function requestCodeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let challenge: string | null = null
  const res = await runAction(async () => { challenge = await requestCode(String(fd.get('identifier') ?? '')) })
  if (challenge) redirect(`/portal/verify?c=${challenge}`)
  return res
}

export async function verifyCodeAction(challenge: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await verifyCode(challenge, String(fd.get('code') ?? ''))
  if (r.ok) redirect('/portal/home')
  if (r.locked) redirect('/portal?expired=1')
  return { ok: false, message: 'That code is not correct. Check the latest message and try again.' }
}

export async function chooseAction(studentId: string, _: ActionResult): Promise<ActionResult> {
  if (!(await chooseStudent(studentId))) return { ok: false, message: 'Please sign in again.' }
  redirect('/portal/home')
}

export async function logoutAction() {
  await portalLogout()
  redirect('/portal?signedout=1')
}

export async function uploadAction(documentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  let done = false
  const res = await runAction(async () => {
    const file = fd.get('file')
    if (!(file instanceof File)) return { ok: false, message: 'Choose a file.' }
    await portalUpload(documentId, file)
    revalidatePath('/portal/home')
    done = true
  })
  if (done) redirect('/portal/home?uploaded=1')
  return res
}

export async function submitCourierAction(shipmentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await portalSubmitCourier(shipmentId, String(fd.get('courierCompany') ?? ''), String(fd.get('trackingNumber') ?? ''), String(fd.get('dispatchDate') ?? '') || null)
    revalidatePath('/portal/home')
  }, 'Thank you. Your courier details were sent to our team.')
}

export async function passwordLoginAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ok = await passwordLogin(String(fd.get('loginId') ?? ''), String(fd.get('password') ?? ''))
  if (ok) redirect('/portal/home')
  return { ok: false, message: 'The Student ID / email or password is not correct, or the account is locked for 15 minutes after repeated attempts.' }
}

export async function setPasswordAction(token: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  let done = false
  const res = await runAction(async () => {
    await setPasswordWithLink(token, String(fd.get('password') ?? ''), String(fd.get('confirm') ?? ''))
    done = true
  })
  if (done) redirect('/portal?passwordset=1')
  return res
}

export async function forgotPasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => { await requestPasswordReset(String(fd.get('loginId') ?? '')) },
    'If an active account with a verified email address matches, we have emailed a reset link. It is valid for 1 hour.')
}

export async function markNoticesReadAction(): Promise<ActionResult> {
  await markNoticesRead()
  revalidatePath('/portal/home')
  return { ok: true }
}

export async function portalReferralAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => { await portalSubmitReferral(fd); revalidatePath('/portal/home') },
    'Thank you! We will contact your friend. You can follow the progress below.')
}

export async function publicReferralAction(code: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => { await publicSubmitReferral(code, fd) }, 'Thank you! Our team will contact you soon.')
}
