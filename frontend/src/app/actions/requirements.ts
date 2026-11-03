'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import * as rq from '@/services/requirements'
import { formObject } from '@/lib/validation'
import { runAction } from './run-action'

export async function acknowledgeAction(studentId: string, noticeId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await rq.acknowledgeAdvisory(ctx, studentId, noticeId); revalidatePath(`/students/${studentId}`) },
    'Acknowledged. This records that you have seen the notice; it is not an eligibility decision.')
}

export async function saveRequirementAction(groupId: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const all = (k: string) => fd.getAll(k).map(String)
  const kinds = all('itemRecordKind'); const keys = all('itemSubjectKey'); const names = all('itemSubjectName'); const pct = all('itemMinPercentage'); const marks = all('itemMinMarks'); const grading = all('itemGrading')
  const items = names.map((n, i) => ({ record_kind: kinds[i], subject_key: keys[i], subject_name: n, min_percentage: pct[i], min_marks: marks[i], grading_system: grading[i] }))
  const v = formObject(fd)
  let g: string | null = null
  const res = await runAction(async () => { g = await rq.saveRequirement(ctx, groupId, v, items, v.reason); revalidatePath('/admin/requirements') })
  if (res.ok && g) redirect(`/admin/requirements/${g}?saved=1`)
  return res
}

export async function requirementStatusAction(groupId: string, active: boolean, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await rq.setRequirementStatus(ctx, groupId, active, String(fd.get('reason') ?? '')); revalidatePath(`/admin/requirements/${groupId}`); revalidatePath('/admin/requirements') },
    active ? 'Activated.' : 'Deactivated.')
}
