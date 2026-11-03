'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import * as md from '@/services/master-data'
import { formObject } from '@/lib/validation'
import { runAction } from './run-action'

const refresh = () => { revalidatePath('/admin/master-data', 'layout'); revalidatePath('/students/new'); revalidatePath('/universities') }

export async function saveCountryAction(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await md.saveCountry(ctx, id, formObject(fd)); refresh() }, id ? 'Country saved.' : 'Country added.')
}

export async function saveCourseAction(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  v.countryIds = fd.getAll('countryIds').map(String).join(',')
  return runAction(async () => { await md.saveCourse(ctx, id, v); refresh() }, id ? 'Course saved.' : 'Course added.')
}

export async function masterStatusAction(kind: 'country' | 'university' | 'course', id: string, active: boolean, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await md.setMasterStatus(ctx, kind, id, active); refresh() },
    active ? 'Activated – available for new applications.' : 'Deactivated – not offered for new applications; existing students keep it.')
}

export async function requestMasterDataAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await md.requestMasterData(ctx, formObject(fd)); revalidatePath('/admin/master-data/requests') },
    'Request sent. It becomes available in the lists once an authorised person approves it.')
}

export async function decideRequestAction(id: string, approve: boolean, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await md.decideRequest(ctx, id, approve, String(fd.get('note') ?? ''), String(fd.get('code') ?? '')); refresh() },
    approve ? 'Approved and added (active).' : 'Request rejected.')
}
