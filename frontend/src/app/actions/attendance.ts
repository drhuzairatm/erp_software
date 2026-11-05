'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import { formObject } from '@/lib/validation'
import * as att from '@/services/attendance'
import { runAction } from './run-action'

export async function markAttendanceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  const label: Record<string, string> = { check_in: 'Checked in', check_out: 'Checked out', break_start: 'Break started', break_end: 'Break ended' }
  return runAction(async () => {
    const photo = fd.get('photo')
    const r = await att.markAttendance(ctx, { orgId: v.orgId, action: v.action, method: v.method, lat: v.lat, lng: v.lng, accuracy: v.accuracy, qr: v.qr, device: v.device, photo: photo instanceof File ? photo : null })
    revalidatePath('/attendance')
    const flagged = r.flags.map((f) => att.FLAG_LABEL[f] ?? f).join(', ')
    return { ok: true, message: flagged ? `${label[v.action ?? '']}. Sent to manual review: ${flagged}.` : `${label[v.action ?? '']}.` }
  })
}

export async function requestCorrectionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.requestCorrection(ctx, formObject(fd)); revalidatePath('/attendance') }, 'Correction request sent.')
}

export async function requestLeaveAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.requestLeave(ctx, formObject(fd)); revalidatePath('/attendance') }, 'Request sent.')
}

export async function cancelLeaveAction(id: string, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.decideLeave(ctx, id, 'cancelled'); revalidatePath('/attendance') }, 'Request cancelled.')
}

const decider = { review: att.decideReview, correction: att.decideCorrection, leave: att.decideLeave }
export async function decideAttendanceAction(kind: 'review' | 'correction' | 'leave', id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => { await decider[kind](ctx, id, v.decision ?? '', v.note); revalidatePath('/attendance/manage') }, 'Decision recorded.')
}

export async function setAttendanceStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.setAttendanceStatus(ctx, formObject(fd)); revalidatePath('/attendance/manage') }, 'Status recorded.')
}

export async function saveOfficeAction(orgId: string, id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.saveOffice(ctx, orgId, id, formObject(fd)); revalidatePath('/attendance/settings') }, 'Office saved.')
}

export async function setOfficeActiveAction(id: string, active: boolean, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.setOfficeActive(ctx, id, active); revalidatePath('/attendance/settings') }, active ? 'Office activated.' : 'Office deactivated.')
}

export async function savePolicyAction(orgId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await att.savePolicy(ctx, orgId, formObject(fd)); revalidatePath('/attendance/settings') }, 'Policy saved.')
}

export async function issueKioskQrAction(officeId: string) {
  const ctx = await requireUser()
  const base = process.env.APP_URL || 'http://localhost:3000'
  const r = await att.issueOfficeQr(ctx, officeId, base)
  return { dataUrl: r.dataUrl, expiresAt: r.expiresAt.toISOString() }
}
