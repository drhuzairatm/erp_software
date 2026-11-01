'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { chooseStudent, portalLogout, portalSubmitCourier, portalUpload, requestCode, verifyCode } from '@/server/portal'
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
