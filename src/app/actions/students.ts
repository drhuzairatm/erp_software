'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/server/auth/session'
import * as students from '@/server/services/students'
import { formObject } from '@/server/validation'
import { runAction } from './run-action'

const path = (id: string) => `/students/${id}`

export async function createStudentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  let id: string | null = null
  const res = await runAction(async () => {
    const r = await students.createStudent(ctx, formObject(fd))
    if (!r.ok) {
      return { ok: false, message: 'A student with the same phone number or email may already exist. Review the matches below.', data: { duplicates: r.duplicates } }
    }
    id = r.id
  })
  if (id) redirect(`${path(id)}?created=1`)
  return res
}

export async function updateStudentAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const res = await runAction(async () => { await students.updateStudent(ctx, id, formObject(fd)) })
  if (res.ok) redirect(`${path(id)}?updated=1`)
  return res
}

export async function changeStageAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const r = await students.changeStage(ctx, id, formObject(fd))
    if (!r.ok) return { ok: false, message: 'Please review these warnings before continuing.', data: { warnings: r.warnings, toStage: fd.get('toStage') } }
    revalidatePath(path(id))
    return { ok: true, message: 'Stage updated.' }
  })
}

export async function assignAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const v = formObject(fd)
    const [userId, orgId] = (v.assignee ?? '').split('|')
    await students.setAssignment(ctx, id, { assignmentType: v.assignmentType, userId: userId || undefined, orgId: orgId || v.orgId })
    revalidatePath(path(id))
  }, 'Assignment saved.')
}

export async function noteAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await students.addNote(ctx, id, formObject(fd)); revalidatePath(path(id)) }, 'Note added.')
}

export async function followupAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await students.addFollowup(ctx, id, formObject(fd)); revalidatePath(path(id)) }, 'Follow-up logged.')
}

export async function visaAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await students.updateVisaDetails(ctx, id, formObject(fd)); revalidatePath(path(id)) }, 'Visa details saved.')
}

export async function admissionAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await students.updateAdmissionDetails(ctx, id, formObject(fd)); revalidatePath(path(id)) }, 'Admission details saved.')
}

export async function mergeAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    await students.mergeStudents(ctx, id, v.mergedCode ?? '', v.reason ?? '')
    revalidatePath(path(id))
  }, 'Records merged. The duplicate is kept for history and points to this record.')
}

export async function archiveAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    await students.setArchived(ctx, id, v.archive === 'yes', v.reason)
    revalidatePath(path(id))
  }, v.archive === 'yes' ? 'Record archived.' : 'Record restored.')
}
