'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import * as tasks from '@/services/tasks'
import { formObject } from '@/lib/validation'
import { runAction } from './run-action'

export async function createTaskAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  let id: string | null = null
  const res = await runAction(async () => { id = await tasks.createTask(ctx, v) })
  if (id) {
    if (v.returnTo?.startsWith('/students/')) {
      revalidatePath(v.returnTo)
      return { ok: true, message: 'Task created.' }
    }
    redirect(`/tasks/${id}?created=1`)
  }
  return res
}

export async function updateTaskAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  // Only send fields that were present in the form, so partial forms don't clear values
  const raw: Record<string, unknown> = {}
  for (const k of ['title', 'description', 'assignedTo', 'priority', 'status', 'dueDate', 'progressPercent', 'delayReason', 'delayNote']) {
    if (fd.has(k)) raw[k] = v[k]
  }
  return runAction(async () => {
    await tasks.updateTask(ctx, id, raw)
    revalidatePath(`/tasks/${id}`)
  }, 'Task updated.')
}

export async function commentAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await tasks.addTaskComment(ctx, id, String(fd.get('body') ?? ''))
    revalidatePath(`/tasks/${id}`)
  }, 'Comment added.')
}

export async function submitTaskAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await tasks.submitTask(ctx, id, String(fd.get('note') ?? '')); revalidatePath(`/tasks/${id}`) }, 'Submitted for review.')
}

export async function reviewTaskAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const decision = String(fd.get('decision') ?? '')
  return runAction(async () => { await tasks.reviewTask(ctx, id, decision, String(fd.get('note') ?? '')); revalidatePath(`/tasks/${id}`) }, decision === 'approved' ? 'Approved. The task is completed.' : 'Corrections requested.')
}

export async function extendTaskAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await tasks.extendTask(ctx, id, String(fd.get('date') ?? ''), String(fd.get('time') ?? ''), String(fd.get('reason') ?? '')); revalidatePath(`/tasks/${id}`) }, 'Deadline extended. The original deadline stays on record.')
}

export async function saveTaskRemindersAction(orgId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await tasks.saveTaskReminderSettings(ctx, orgId, fd.getAll('before').map(Number), fd.get('atDeadline') === 'on', fd.get('afterOverdue') === 'on', fd.get('escalate') === 'on')
    revalidatePath('/tasks/reports')
  }, 'Reminder settings saved.')
}
