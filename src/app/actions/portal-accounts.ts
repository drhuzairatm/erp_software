'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/server/auth/session'
import { deliverPortalEmails } from '@/server/notifications/portal-email'
import * as pa from '@/server/services/portal-accounts'
import { runAction } from './run-action'

const path = (id: string) => `/students/${id}`

export async function issuePortalLinkAction(studentId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const res = await pa.issuePortalLink(ctx, studentId)
    // faster delivery only: the scheduled sender (every minute) delivers anything still queued
    if (res.mode === 'emailed') after(() => deliverPortalEmails(10).then(() => undefined, () => undefined))
    // no page refresh here: the one-time link must stay on screen (status updates on the next visit)
    return { ok: true, data: res.mode === 'link' ? { link: res.link } : undefined, message: res.mode === 'emailed'
      ? 'Set-up link queued for the verified email address (sent securely; staff cannot see it). It is valid for 72 hours.'
      : 'Copy this one-time link and give it to the student personally (it is shown only now; valid for 72 hours). It was not emailed because the email address is not verified.' }
  })
}

export async function portalAccountStatusAction(studentId: string, enable: boolean, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pa.setPortalAccountEnabled(ctx, studentId, enable, String(fd.get('reason') ?? '')); revalidatePath(path(studentId)) },
    enable ? 'Portal account enabled.' : 'Portal account disabled; the student was signed out.')
}

export async function publishAction(studentId: string, documentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pa.publishDocument(ctx, documentId, String(fd.get('title') ?? '')); revalidatePath(path(studentId)) },
    'Published to the student portal. The student can download it now.')
}

export async function unpublishAction(studentId: string, publicationId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pa.unpublishDocument(ctx, publicationId, String(fd.get('reason') ?? '')); revalidatePath(path(studentId)) },
    'Withdrawn from the portal.')
}
