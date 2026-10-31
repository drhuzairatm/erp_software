'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/server/auth/session'
import * as tasks from '@/server/services/tasks'
import { formObject } from '@/server/validation'
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
  for (const k of ['title', 'description', 'assignedTo', 'priority', 'status', 'dueDate', 'delayReason', 'delayNote']) {
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
