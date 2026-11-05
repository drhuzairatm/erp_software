'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import { invalid } from '@/lib/errors'
import { formObject } from '@/lib/validation'
import * as dvr from '@/services/dvr'
import { uploadSecureFile } from '@/services/secure-files'
import { runAction } from './run-action'

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '')
const page = (id: string) => `/pre-admission/${id}`

async function act(id: string, message: string, fn: (ctx: Awaited<ReturnType<typeof requireUser>>) => Promise<unknown>): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await fn(ctx); revalidatePath(page(id)) }, message)
}

export async function createDvrAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  let id: string | null = null
  const res = await runAction(async () => { id = await dvr.createDvr(ctx, text(fd, 'orgId'), formObject(fd)) })
  if (id) redirect(page(id))
  return res
}
export async function updateDvrAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  let flagged = false
  const res = await runAction(async () => { flagged = await dvr.updateDvr(ctx, id, formObject(fd)); revalidatePath(page(id)) }, 'Details saved.')
  return flagged && res.ok ? { ...res, message: 'Details saved. The change is recorded and the request is flagged for re-verification.' } : res
}
export async function addDvrDocumentsAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'Documents added.', (ctx) => dvr.addDvrDocuments(ctx, id, text(fd, 'category'), text(fd, 'label'), fd.getAll('files') as File[]))
}
export async function uploadDvrVersionAction(id: string, documentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'New version uploaded. Earlier versions are kept.', async (ctx) => {
    const file = fd.get('file')
    if (!(file instanceof File) || file.size === 0) throw invalid('Choose a PDF to upload.')
    await uploadSecureFile(ctx, 'dvr', documentId, file)
  })
}
export async function removeDvrDocumentAction(id: string, documentId: string, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  return act(id, 'Document removed.', (ctx) => dvr.removeDvrDocument(ctx, documentId))
}
export async function submitDvrAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'Sent to Documentation.', (ctx) => dvr.submitDvr(ctx, id, text(fd, 'note')))
}
export async function assignDvrAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'Reviewer saved.', (ctx) => dvr.assignDvr(ctx, id, text(fd, 'reviewer'), text(fd, 'reason')))
}
export async function startDvrAction(id: string, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  return act(id, 'Verification started.', (ctx) => dvr.startDvr(ctx, id))
}
export async function reviewDvrDocumentAction(id: string, documentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'Result recorded.', (ctx) => dvr.reviewDvrDocument(ctx, documentId, text(fd, 'result'), text(fd, 'notes')))
}
export async function requestDvrDocumentAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'Missing document recorded.', (ctx) => dvr.requestDvrDocument(ctx, id, text(fd, 'category'), text(fd, 'notes')))
}
export async function sendBackDvrAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'Status updated.', (ctx) => dvr.sendBackDvr(ctx, id, text(fd, 'status'), text(fd, 'note')))
}
export async function completeDvrAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'Assessment recorded.', (ctx) => dvr.completeDvr(ctx, id, text(fd, 'overall'), text(fd, 'notes')))
}
export async function returnDvrAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'Returned to the counsellor.', (ctx) => dvr.returnDvr(ctx, id, text(fd, 'note')))
}
export async function closeDvrAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'Request closed.', (ctx) => dvr.closeDvr(ctx, id, text(fd, 'note')))
}
export async function cancelDvrAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'Request cancelled.', (ctx) => dvr.cancelDvr(ctx, id, text(fd, 'reason')))
}
export async function linkDvrStudentAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return act(id, 'Linked to the student. Nothing on the student record changed.', (ctx) => dvr.linkDvrStudent(ctx, id, text(fd, 'studentCode')))
}
