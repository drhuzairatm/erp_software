'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import * as documents from '@/services/documents'
import { formObject } from '@/lib/validation'
import { runAction } from './run-action'

const tab = (studentId: string) => `/students/${studentId}`

export async function uploadAction(studentId: string, documentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const file = fd.get('file')
    if (!(file instanceof File)) return { ok: false, message: 'Choose a file to upload.' }
    await documents.uploadDocument(ctx, documentId, file)
    revalidatePath(tab(studentId))
  }, 'File uploaded. It now needs review.')
}

export async function documentActionAction(studentId: string, documentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  const MESSAGES: Record<string, string> = {
    start_review: 'Review started.', verify: 'Marked verified.', submit: 'Submitted for manager approval.', approve: 'Approved.',
    request_changes: 'Changes requested.', reject: 'Rejected.', expire: 'Marked expired.',
  }
  return runAction(async () => {
    await documents.documentAction(ctx, documentId, v.action ?? '', v.reason)
    revalidatePath(tab(studentId))
    revalidatePath(`${tab(studentId)}/documents/${documentId}`)
  }, MESSAGES[v.action ?? ''] ?? 'Saved.')
}

export async function verificationAction(studentId: string, documentId: string, requirementId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    await documents.recordVerification(ctx, documentId, requirementId, v.result ?? '', v.comment,
      v.detected === 'yes' ? true : v.detected === 'no' ? false : null)
    revalidatePath(`${tab(studentId)}/documents/${documentId}`)
  }, 'Recorded.')
}

export async function annotationAction(studentId: string, documentId: string, fileId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    let rects: unknown = []
    try { rects = JSON.parse(String(fd.get('rects') ?? '[]')) } catch { rects = [] }
    await documents.addAnnotation(ctx, fileId, Number(fd.get('page')), rects, String(fd.get('quote') ?? '') || undefined, String(fd.get('body') ?? ''))
    revalidatePath(`${tab(studentId)}/documents/${documentId}`)
  }, 'Comment added.')
}

export async function custodyAction(studentId: string, documentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    await documents.recordCustody(ctx, documentId, v.location ?? '', v.note, v.ref)
    revalidatePath(tab(studentId))
  }, 'Location recorded.')
}

export async function documentDetailsAction(studentId: string, documentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    await documents.updateDocumentDetails(ctx, documentId, v.expiryDate, v.notes, v.issuingCountryId)
    revalidatePath(tab(studentId))
  }, 'Saved.')
}

export async function addChecklistItemAction(studentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    await documents.addChecklistItem(ctx, studentId, v.documentTypeId ?? '', v.label ?? '', v.required === 'yes')
    revalidatePath(tab(studentId))
  }, 'Checklist item added.')
}
