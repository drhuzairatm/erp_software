'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import * as tickets from '@/services/tickets'
import { runAction } from './run-action'

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '')

export async function replyTicketAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await tickets.replyTicket(ctx, id, text(fd, 'body'), text(fd, 'next'), fd.getAll('files') as File[]); revalidatePath(`/tickets/${id}`) }, 'Reply sent.')
}
export async function setTicketStatusAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await tickets.setTicketStatus(ctx, id, text(fd, 'status'), text(fd, 'note')); revalidatePath(`/tickets/${id}`) }, 'Status saved.')
}
export async function assignTicketAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await tickets.assignTicket(ctx, id, text(fd, 'user'), text(fd, 'reason')); revalidatePath(`/tickets/${id}`) }, 'Assignment saved.')
}
