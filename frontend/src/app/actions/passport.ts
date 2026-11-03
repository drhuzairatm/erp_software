'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/server/auth/session'
import { deliverAuthMessages } from '@/server/notifications/auth-message'
import * as pp from '@/server/services/passport'
import { formObject } from '@/server/validation'
import { runAction } from './run-action'

const studentPath = (id: string) => `/students/${id}`

export async function recordPassportAction(studentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => { await pp.recordPassport(ctx, studentId, v); revalidatePath(studentPath(studentId)) },
    v.kind === 'correction' ? 'Correction recorded as a new version.'
      : 'New passport recorded and awaiting verification. It becomes the active passport only after it is verified.')
}

export async function verifyPassportAction(studentId: string, passportId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const decision = String(fd.get('decision') ?? '')
  return runAction(async () => { await pp.verifyPassport(ctx, passportId, decision, String(fd.get('note') ?? '')); revalidatePath(studentPath(studentId)) },
    decision === 'verified' ? 'Passport verified. It is now the active passport.' : 'Passport rejected. The previous passport stays active.')
}

export async function passportFollowupAction(studentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pp.addPassportFollowup(ctx, studentId, formObject(fd)); revalidatePath(studentPath(studentId)) }, 'Saved.')
}

export async function sendEmailVerificationAction(studentId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await pp.sendEmailVerification(ctx, studentId)
    after(() => deliverAuthMessages(10).then(() => undefined, () => undefined)) // faster delivery; cron delivers anyway
    revalidatePath(studentPath(studentId))
  },
    'Verification email queued. The address is verified only when the student opens the link.')
}

export async function addValidityRuleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pp.addValidityRule(ctx, formObject(fd)); revalidatePath('/admin/passport-rules') }, 'Rule added.')
}

export async function toggleValidityRuleAction(id: string, active: boolean, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pp.setValidityRuleActive(ctx, id, active); revalidatePath('/admin/passport-rules') })
}

export async function contactStageAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pp.setContactRequiredStage(ctx, String(fd.get('stageKey') ?? '') || null); revalidatePath('/admin/passport-rules') }, 'Saved.')
}
