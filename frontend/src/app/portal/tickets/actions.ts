'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { portalCreateTicket, portalReplyTicket } from '@/services/tickets'
import { runAction } from '../../actions/run-action'

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '')

export async function createTicketAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null
  const res = await runAction(async () => { id = await portalCreateTicket(text(fd, 'category'), text(fd, 'subject'), text(fd, 'body'), fd.getAll('files') as File[]) })
  if (id) redirect(`/portal/tickets/${id}?new=1`)
  return res
}
export async function replyTicketAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => { await portalReplyTicket(id, text(fd, 'body'), fd.getAll('files') as File[]); revalidatePath(`/portal/tickets/${id}`) }, 'Your reply was sent.')
}
