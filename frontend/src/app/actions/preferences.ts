'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import { formObject } from '@/lib/validation'
import * as pref from '@/services/preferences'
import { runAction } from './run-action'

const YEARS = '/admin/master-data/academic-years'
const RULES = '/admin/master-data/country-documents'

export async function savePreferenceAction(studentId: string, rank: number, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pref.savePreference(ctx, studentId, rank, formObject(fd)); revalidatePath(`/students/${studentId}`) }, 'Preference saved.')
}
export async function clearPreferenceAction(studentId: string, rank: number, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pref.clearPreference(ctx, studentId, rank); revalidatePath(`/students/${studentId}`) }, 'Preference removed.')
}
export async function saveAcademicYearAction(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const sort = Number(fd.get('sort'))
  return runAction(async () => { await pref.saveAcademicYear(ctx, id, String(fd.get('code') ?? ''), Number.isInteger(sort) && fd.get('sort') ? sort : null, id ? null : true); revalidatePath(YEARS) }, 'Academic year saved.')
}
export async function setAcademicYearActiveAction(id: string, code: string, active: boolean, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pref.saveAcademicYear(ctx, id, code, null, active); revalidatePath(YEARS) }, active ? 'Activated.' : 'Deactivated.')
}
export async function saveCountryRuleAction(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pref.saveCountryRule(ctx, id, formObject(fd)); revalidatePath(RULES) }, 'Rule saved. It stays inactive until it is verified and activated.')
}
export async function verifyCountryRuleAction(id: string, verified: boolean, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pref.verifyCountryRule(ctx, id, verified, String(fd.get('note') ?? '')); revalidatePath(RULES) }, verified ? 'Marked verified.' : 'Marked unverified and deactivated.')
}
export async function setCountryRuleActiveAction(id: string, active: boolean, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await pref.setCountryRuleActive(ctx, id, active); revalidatePath(RULES) }, active ? 'Rule activated.' : 'Rule deactivated.')
}
