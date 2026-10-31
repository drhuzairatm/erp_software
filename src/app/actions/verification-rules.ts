'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/server/auth/session'
import * as rules from '@/server/services/verification-rules'
import { formObject } from '@/server/validation'
import { runAction } from './run-action'

const base = '/admin/verification-rules'

export async function saveRuleAction(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  let newId: string | null = null
  const res = await runAction(async () => { newId = await rules.saveRuleDraft(ctx, id, formObject(fd)); revalidatePath(base) }, 'Saved.')
  if (!id && newId) redirect(`${base}/${newId}`)
  if (id) revalidatePath(`${base}/${id}`)
  return res
}

export async function addRequirementAction(ruleId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await rules.addRequirement(ctx, ruleId, formObject(fd)); revalidatePath(`${base}/${ruleId}`) }, 'Check added.')
}

export async function removeRequirementAction(ruleId: string, reqId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await rules.removeRequirement(ctx, reqId); revalidatePath(`${base}/${ruleId}`) }, 'Removed.')
}

export async function approveRuleAction(ruleId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await rules.approveRule(ctx, ruleId); revalidatePath(base); revalidatePath(`${base}/${ruleId}`) },
    'Approved. The rule now applies to documents reviewed from today; the previous version (if any) is retired.')
}

export async function newVersionAction(ruleId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  let id: string | null = null
  const res = await runAction(async () => { id = await rules.newRuleVersion(ctx, ruleId) })
  if (id) redirect(`${base}/${id}`)
  return res
}

export async function deleteDraftAction(ruleId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  const res = await runAction(async () => { await rules.deleteDraft(ctx, ruleId) })
  if (res.ok) redirect(base)
  return res
}
