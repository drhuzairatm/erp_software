'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import * as uni from '@/services/universities'
import { formObject } from '@/lib/validation'
import { runAction } from './run-action'

export async function saveUniversityAction(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  let newId: string | null = null
  const res = await runAction(async () => {
    newId = await uni.saveUniversity(ctx, id, formObject(fd))
    revalidatePath('/universities')
  }, 'Saved.')
  if (!id && newId) redirect(`/universities/${newId}`)
  if (id) revalidatePath(`/universities/${id}`)
  return res
}

export async function addPartAction(universityId: string, part: 'campus' | 'course' | 'intake' | 'requirement', _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await uni.addUniversityPart(ctx, universityId, part, formObject(fd))
    revalidatePath(`/universities/${universityId}`)
  }, part === 'requirement' ? 'Requirement added. Students already assigned to this university get it on their checklist.' : 'Added.')
}

export async function togglePartAction(universityId: string, part: 'campus' | 'course' | 'intake', id: string, active: boolean, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await uni.setUniversityPartActive(ctx, part, id, active)
    revalidatePath(`/universities/${universityId}`)
  }, active ? 'Activated.' : 'Deactivated.')
}

export async function removeRequirementAction(universityId: string, id: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await uni.removeRequirement(ctx, id)
    revalidatePath(`/universities/${universityId}`)
  }, 'Requirement removed for future checklists. Existing student checklists are unchanged.')
}
