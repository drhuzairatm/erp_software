'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/server/auth/session'
import * as att from '@/server/services/attestation'
import { formObject } from '@/server/validation'
import { runAction } from './run-action'

const docPath = (studentId: string, docId: string) => `/students/${studentId}/documents/${docId}`
const base = '/admin/attestation-routes'

export async function startAttestationAction(studentId: string, docId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.startAttestation(ctx, docId, String(fd.get('routeId') ?? '')); revalidatePath(docPath(studentId, docId)) }, 'Attestation started.')
}

export async function stepAction(studentId: string, docId: string, stepId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  const MSG: Record<string, string> = { start: 'Stage started.', complete: 'Stage completed.', not_required: 'Marked not required.', exception: 'Exception recorded.', assign: 'Assigned.', note: 'Saved.' }
  return runAction(async () => {
    await att.stepAction(ctx, stepId, v.action ?? '', { reference: v.reference, date: v.date, comment: v.comment, assignee: v.assignee })
    revalidatePath(docPath(studentId, docId))
  }, MSG[v.action ?? ''] ?? 'Saved.')
}

export async function stepFileAction(studentId: string, docId: string, stepId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const file = fd.get('file')
    if (!(file instanceof File)) return { ok: false, message: 'Choose a file.' }
    await att.uploadStepFile(ctx, stepId, file)
    revalidatePath(docPath(studentId, docId))
  }, 'Supporting document uploaded.')
}

export async function cancelAttestationAction(studentId: string, docId: string, attestationId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.cancelAttestation(ctx, attestationId, String(fd.get('reason') ?? '')); revalidatePath(docPath(studentId, docId)) }, 'Attestation cancelled.')
}

// ---- configuration
export async function saveRouteAction(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  let newId: string | null = null
  const res = await runAction(async () => { newId = await att.saveRouteDraft(ctx, id, formObject(fd)); revalidatePath(base) }, 'Saved.')
  if (!id && newId) redirect(`${base}/${newId}`)
  if (id) revalidatePath(`${base}/${id}`)
  return res
}
export async function addStageAction(routeId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.addStage(ctx, routeId, formObject(fd)); revalidatePath(`${base}/${routeId}`) }, 'Stage added.')
}
export async function removeStageAction(routeId: string, stageId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.removeStage(ctx, stageId); revalidatePath(`${base}/${routeId}`) }, 'Removed.')
}
export async function moveStageAction(routeId: string, stageId: string, dir: 'up' | 'down', _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.moveStage(ctx, stageId, dir); revalidatePath(`${base}/${routeId}`) })
}
export async function approveRouteAction(routeId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.approveRoute(ctx, routeId); revalidatePath(base); revalidatePath(`${base}/${routeId}`) }, 'Approved. The route can be used from today.')
}
export async function newRouteVersionAction(routeId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  let id: string | null = null
  const res = await runAction(async () => { id = await att.newRouteVersion(ctx, routeId) })
  if (id) redirect(`${base}/${id}`)
  return res
}
export async function deleteRouteDraftAction(routeId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  const res = await runAction(async () => { await att.deleteRouteDraft(ctx, routeId) })
  if (res.ok) redirect(base)
  return res
}
export async function addAuthorityAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.addAuthority(ctx, formObject(fd)); revalidatePath(base) }, 'Authority added.')
}
export async function toggleAuthorityAction(id: string, active: boolean, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.toggleAuthority(ctx, id, active); revalidatePath(base) })
}
