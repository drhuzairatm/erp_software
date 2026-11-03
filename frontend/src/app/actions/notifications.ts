'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import * as n from '@/services/notifications'
import { formObject } from '@/lib/validation'
import { runAction } from './run-action'

export async function consentAction(studentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    await n.recordConsent(ctx, studentId, v.channel ?? '', v.recipient ?? '', v.granted === 'yes', v.source ?? '')
    revalidatePath(`/students/${studentId}`)
  }, 'Consent recorded.')
}

export async function retryMessageAction(id: string, back: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await n.retryMessage(ctx, id); revalidatePath(back) }, 'Message queued again.')
}

export async function processNowAction(_: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const r = await n.processNow(ctx)
    revalidatePath('/notifications')
    return { ok: true, message: `Processed ${r.processed}: ${r.sent} sent, ${r.test} kept in test mode, ${r.skipped} skipped, ${r.failed} failed, ${r.retry} will retry.` }
  })
}

export async function saveTemplateAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await n.saveTemplate(ctx, id, formObject(fd)); revalidatePath('/admin/notifications') }, 'Template saved.')
}

export async function saveRuleAction(orgId: string, eventKey: string, channel: string, audience: string, templateId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await n.saveRule(ctx, orgId, eventKey, channel, audience, fd.get('enabled') === 'yes', templateId, fd.getAll('stage').map(String))
    revalidatePath('/admin/notifications')
  }, 'Saved.')
}
