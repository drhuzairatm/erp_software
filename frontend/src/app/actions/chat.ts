'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import * as chat from '@/services/chat'
import { saveChatAlertSettings, setConversationMute } from '@/services/chat-notifications'
import { runAction } from './run-action'

export async function openDirectAction(fd: FormData) {
  const ctx = await requireUser()
  const [orgId, userId] = String(fd.get('person') ?? '').split('|')
  const id = await chat.openDirect(ctx, orgId, userId)
  redirect(`/chat?c=${id}`)
}

export async function createGroupAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  let id: string | null = null
  const res = await runAction(async () => {
    id = await chat.createGroup(ctx, { orgId: String(fd.get('orgId') ?? ''), name: String(fd.get('name') ?? ''), groupType: String(fd.get('groupType') ?? ''), members: fd.getAll('members').map(String) })
  })
  if (id) redirect(`/chat?c=${id}`)
  return res
}

export async function sendMessageAction(conv: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const file = fd.get('file')
    await chat.sendMessage(ctx, conv, { body: String(fd.get('body') ?? ''), replyTo: String(fd.get('replyTo') ?? ''), taskId: String(fd.get('taskId') ?? ''), file: file instanceof File ? file : null })
    return { ok: true }
  })
}

type Simple = { ok: boolean; message?: string }
const wrap = async (fn: () => Promise<void>): Promise<Simple> => { const r = await runAction(async () => { await fn() }); return { ok: r.ok, message: r.ok ? undefined : r.message } }
export async function chatEditAction(id: string, body: string) { const ctx = await requireUser(); return wrap(() => chat.editMessage(ctx, id, body)) }
export async function chatDeleteAction(id: string) { const ctx = await requireUser(); return wrap(() => chat.deleteMessage(ctx, id)) }
export async function chatReactAction(id: string, emoji: string, on: boolean) { const ctx = await requireUser(); return wrap(() => chat.reactToMessage(ctx, id, emoji, on)) }
export async function chatMuteAction(conv: string, muted: boolean) { const ctx = await requireUser(); return wrap(() => setConversationMute(ctx, conv, muted)) }
export async function saveChatAlertsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await saveChatAlertSettings(ctx, { inApp: fd.get('inApp') === 'on', sound: fd.get('sound') === 'on', desktopPreview: fd.get('desktopPreview') === 'on' })
    revalidatePath('/my-notifications/preferences')
  }, 'Chat alerts saved.')
}
export async function chatPinAction(id: string, on: boolean) { const ctx = await requireUser(); return wrap(() => chat.pinMessage(ctx, id, on)) }
export async function chatMemberAction(conv: string, user: string, present: boolean) { const ctx = await requireUser(); return wrap(() => chat.setGroupMember(ctx, conv, user, present)) }
export async function chatSyncGroupAction(conv: string) { const ctx = await requireUser(); return wrap(() => chat.syncGroup(ctx, conv)) }
export async function chatForwardAction(fromMessage: string, conv: string) {
  const ctx = await requireUser()
  return wrap(async () => { await chat.sendMessage(ctx, conv, { forwardFrom: fromMessage }) })
}
