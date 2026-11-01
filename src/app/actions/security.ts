'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/server/auth/session'
import { acknowledgeAlert, clearFileManually } from '@/server/services/security'
import { runAction } from './run-action'

export async function clearFileAction(fileId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await clearFileManually(ctx, fileId, String(fd.get('reason') ?? ''))
    revalidatePath('/students', 'layout')
  }, 'Manual security clearance recorded (this is not a virus scan).')
}

export async function acknowledgeAlertAction(alertId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await acknowledgeAlert(ctx, alertId, String(fd.get('note') ?? ''))
    revalidatePath('/admin/security')
  }, 'Alert acknowledged.')
}
