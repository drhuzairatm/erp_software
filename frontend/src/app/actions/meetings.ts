'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import { formObject } from '@/lib/validation'
import * as meetings from '@/services/meetings'
import { runAction } from './run-action'

const input = (fd: FormData) => ({ ...formObject(fd), attendees: fd.getAll('attendees') })

export async function createMeetingAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  let id: string | null = null
  const res = await runAction(async () => { id = await meetings.createMeeting(ctx, String(fd.get('orgId') ?? ''), input(fd)) })
  if (id) redirect(`/meetings/${id}`)
  return res
}
export async function updateMeetingAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await meetings.updateMeeting(ctx, id, input(fd)); revalidatePath(`/meetings/${id}`) }, 'Meeting saved.')
}
export async function cancelMeetingAction(id: string, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await meetings.cancelMeeting(ctx, id); revalidatePath(`/meetings/${id}`) }, 'Meeting cancelled.')
}
export async function saveMinutesAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await meetings.saveMinutes(ctx, id, String(fd.get('notes') ?? ''), String(fd.get('reason') ?? '')); revalidatePath(`/meetings/${id}`) }, 'Minutes saved. The earlier version is kept.')
}
export async function addDecisionAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await meetings.addDecision(ctx, id, String(fd.get('body') ?? '')); revalidatePath(`/meetings/${id}`) }, 'Decision added.')
}
export async function addActionPointAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await meetings.addAction(ctx, id, formObject(fd)); revalidatePath(`/meetings/${id}`) }, 'Action point added.')
}
export async function actionToTaskAction(meetingId: string, actionId: string, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await meetings.actionToTask(ctx, actionId); revalidatePath(`/meetings/${meetingId}`) }, 'Task created and assigned.')
}
export async function coreTeamAction(orgId: string, userId: string, member: boolean, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await meetings.setCoreTeamMember(ctx, orgId, userId, member); revalidatePath('/meetings/core-team') }, member ? 'Added to the Core Team.' : 'Removed from the Core Team.')
}
