'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import * as payments from '@/services/payments'
import { formObject } from '@/lib/validation'
import { runAction } from './run-action'

export async function recordPaymentAction(studentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await payments.recordEntry(ctx, studentId, formObject(fd))
    revalidatePath(`/students/${studentId}`)
  }, 'Entry recorded. Receipts, refunds and disbursements must be verified by another authorized staff member before they count.')
}

export async function verifyPaymentAction(entryId: string, back: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    await payments.verifyEntry(ctx, entryId, v.decision ?? '', v.note)
    revalidatePath(back)
  }, v.decision === 'verified' ? 'Entry verified.' : 'Entry rejected.')
}

export async function reversePaymentAction(entryId: string, back: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await payments.reverseEntry(ctx, entryId, String(fd.get('reason') ?? ''))
    revalidatePath(back)
  }, 'Reversal recorded and awaiting verification.')
}

export async function correctRateAction(entryId: string, back: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await payments.correctRate(ctx, entryId, String(fd.get('rate') ?? ''), String(fd.get('reason') ?? '')); revalidatePath(back) },
    'Exchange rate corrected; the change is kept in the history.')
}

export async function saveCurrencyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await payments.saveCurrency(ctx, formObject(fd)); revalidatePath('/admin/currencies') }, 'Saved. Existing payments keep their own rates.')
}
