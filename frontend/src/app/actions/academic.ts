'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/server/auth/session'
import * as ac from '@/server/services/academic'
import { formObject } from '@/server/validation'
import { runAction } from './run-action'

const tab = (id: string) => `/students/${id}`
const admin = '/admin/academic-rules'

export async function saveRecordAction(studentId: string, recordId: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const all = (k: string) => fd.getAll(k).map((x) => String(x))
  const keys = all('subjectKey'); const names = all('subjectName'); const max = all('subjectMax'); const got = all('subjectObtained'); const pct = all('subjectPct'); const grade = all('subjectGrade')
  const subjects = names.map((name, i) => ({ key: keys[i], name, max: max[i], obtained: got[i], pct: pct[i], grade: grade[i] }))
  return runAction(async () => { await ac.saveRecord(ctx, studentId, recordId, formObject(fd), subjects); revalidatePath(tab(studentId)) },
    'Saved. Name checks and eligibility were updated.')
}
export async function deleteRecordAction(studentId: string, recordId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await ac.deleteRecord(ctx, studentId, recordId); revalidatePath(tab(studentId)) }, 'Removed.')
}
export async function reviewNameCheckAction(studentId: string, checkId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const d = String(fd.get('decision') ?? '')
  return runAction(async () => { await ac.reviewNameCheck(ctx, checkId, d, String(fd.get('note') ?? '')); revalidatePath(tab(studentId)) },
    d === 'one_and_same' ? 'One and Same case opened and added to the document checklist.' : 'Recorded: no document needed.')
}
export async function prepareOasAction(studentId: string, caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await ac.prepareOneAndSame(ctx, caseId, String(fd.get('templateId') ?? '')); revalidatePath(tab(studentId)) }, 'Preview generated.')
}
export async function requestOasAction(studentId: string, caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const channel = String(fd.get('channel') ?? '')
  let n = 0
  const res = await runAction(async () => { n = await ac.requestOneAndSame(ctx, caseId, channel, String(fd.get('note') ?? '')); revalidatePath(tab(studentId)) })
  return res.ok ? { ok: true, message: channel === 'message' ? `Request queued (${n} message${n === 1 ? '' : 's'}).` : 'Manual request recorded.' } : res
}
export async function cancelOasAction(studentId: string, caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await ac.cancelOneAndSame(ctx, caseId, String(fd.get('reason') ?? '')); revalidatePath(tab(studentId)) }, 'Requirement cancelled.')
}

// configuration
export async function addThresholdAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await ac.addThreshold(ctx, formObject(fd)); revalidatePath(admin) }, 'Threshold added.')
}
export async function toggleThresholdAction(id: string, active: boolean, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await ac.toggleThreshold(ctx, id, active); revalidatePath(admin) })
}
export async function addOasRuleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await ac.addOasRule(ctx, formObject(fd)); revalidatePath(admin) }, 'Rule added.')
}
export async function toggleOasRuleAction(id: string, active: boolean, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await ac.toggleOasRule(ctx, id, active); revalidatePath(admin) })
}
export async function addTemplateAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await ac.addTemplate(ctx, formObject(fd)); revalidatePath(admin) }, 'Draft template saved. A manager or the MD must approve it.')
}
export async function approveTemplateAction(id: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await ac.approveTemplate(ctx, id); revalidatePath(admin) }, 'Template approved.')
}
export async function retireTemplateAction(id: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await ac.retireTemplate(ctx, id); revalidatePath(admin) }, 'Template retired.')
}
export async function academicCheckAction(stageKey: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await ac.setAcademicCheck(ctx, stageKey, String(fd.get('check') ?? '')); revalidatePath(admin) }, 'Saved.')
}
