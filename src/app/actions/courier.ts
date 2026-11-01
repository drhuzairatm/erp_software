'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/server/auth/session'
import * as courier from '@/server/services/courier'
import { formObject } from '@/server/validation'
import { runAction } from './run-action'

const docsPath = (id: string) => `/students/${id}`

export async function issueCourierAction(studentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await courier.issueInstructions(ctx, studentId, String(fd.get('addressId') ?? ''), fd.getAll('documents').map(String), String(fd.get('exception') ?? ''))
    revalidatePath(docsPath(studentId))
  }, 'Courier instructions issued. The student can now see the delivery address in the portal.')
}

export async function recordDispatchAction(studentId: string, shipmentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await courier.recordDispatch(ctx, shipmentId, formObject(fd)); revalidatePath(docsPath(studentId)) }, 'Courier details saved.')
}

export async function shipmentStatusAction(studentId: string, shipmentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const status = String(fd.get('status') ?? '')
  return runAction(async () => { await courier.setShipmentStatus(ctx, shipmentId, status, String(fd.get('note') ?? '')); revalidatePath(docsPath(studentId)) },
    status === 'received' ? 'Receipt confirmed. Now reconcile each original against its approved scan.' : status === 'cancelled' ? 'Shipment cancelled.' : 'Updated.')
}

export async function reconcileShipmentAction(studentId: string, shipmentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const items = [...fd.keys()].filter((k) => k.startsWith('result_')).map((k) => {
    const id = k.slice(7)
    return { id, result: String(fd.get(k)), note: String(fd.get(`note_${id}`) ?? '') }
  })
  return runAction(async () => {
    const outcome = await courier.reconcileShipment(ctx, shipmentId, items)
    revalidatePath(docsPath(studentId))
    return { ok: true, message: outcome === 'completed' ? 'All originals match the approved scans. Courier workflow completed.'
      : 'Reconciliation required: a follow-up task was created for the mismatch.' }
  })
}

export async function saveCourierAddressAction(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await courier.saveCourierAddress(ctx, id, formObject(fd)); revalidatePath('/admin/courier') }, 'Delivery address saved.')
}
