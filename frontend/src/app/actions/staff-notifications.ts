'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import { formObject } from '@/lib/validation'
import { markAllMyNotificationsRead, openMyNotification, publishAnnouncement, setMyNotificationPreference, withdrawAnnouncement } from '@/services/staff-notifications'
import { runAction } from './run-action'

/** Marks the person's own notification as read and goes to its page. The address comes from the database and is internal only. */
export async function openNotificationAction(id: string) {
  const ctx = await requireUser()
  const href = await openMyNotification(ctx, id)
  revalidatePath('/', 'layout')
  redirect(href ?? '/my-notifications')
}

export async function markAllNotificationsReadAction() {
  const ctx = await requireUser()
  await markAllMyNotificationsRead(ctx)
  revalidatePath('/', 'layout')
}

export async function setNotificationPreferenceAction(category: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await setMyNotificationPreference(ctx, category, fd.get('inApp') === 'on', fd.get('email') === 'on')
    revalidatePath('/my-notifications/preferences')
  }, 'Preference saved.')
}

export async function publishAnnouncementAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await publishAnnouncement(ctx, formObject(fd)); revalidatePath('/announcements') }, 'Announcement published.')
}

export async function withdrawAnnouncementAction(id: string, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await withdrawAnnouncement(ctx, id); revalidatePath('/announcements') }, 'Announcement withdrawn.')
}
