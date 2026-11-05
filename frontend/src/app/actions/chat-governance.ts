'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import { formObject } from '@/lib/validation'
import * as gov from '@/services/chat-governance'
import { runAction } from './run-action'

const PATH = '/chat/governance'
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '')

export async function setRetentionAction(orgId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await gov.setRetention(ctx, orgId, { retentionDays: s(fd, 'retentionDays'), archiveDays: s(fd, 'archiveDays'), purge: fd.get('purge') === 'on', reference: s(fd, 'reference') }); revalidatePath(PATH) }, 'Retention policy saved.')
}
export async function setDelegateAction(orgId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await gov.setDelegate(ctx, orgId, s(fd, 'user'), s(fd, 'capability'), s(fd, 'on') !== 'off', s(fd, 'reason')); revalidatePath(PATH) }, 'Saved.')
}
export async function placeHoldAction(orgId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await gov.placeHold(ctx, orgId, formObject(fd) as Record<string, string>); revalidatePath(PATH) }, 'Legal hold placed.')
}
export async function releaseHoldAction(hold: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await gov.releaseHold(ctx, hold, s(fd, 'reason')); revalidatePath(PATH) }, 'Legal hold released.')
}
export async function createRequestAction(orgId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  let id: string | null = null
  const res = await runAction(async () => { id = await gov.createRequest(ctx, orgId, formObject(fd) as Record<string, string>) })
  if (id) redirect(`${PATH}/${id}`)
  return res
}
export async function decideRequestAction(request: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await gov.decideRequest(ctx, request, s(fd, 'decision') === 'approve', s(fd, 'note'), s(fd, 'days')); revalidatePath(`${PATH}/${request}`) }, 'Decision recorded.')
}
export async function closeRequestAction(request: string): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await gov.closeRequest(ctx, request); revalidatePath(`${PATH}/${request}`) }, 'Request closed.')
}
