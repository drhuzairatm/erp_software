'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import { clearSecureFile, removeSecureFile, type SecureContext, uploadSecureFile } from '@/services/secure-files'
import { runAction } from './run-action'

/** Every rule is checked by the service and the database. `path` only says which page to refresh. */
const refresh = (path: string) => { if (path.startsWith('/') && !path.startsWith('//')) revalidatePath(path) }

export async function uploadSecureFileAction(contextType: SecureContext, contextId: string, path: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const file = fd.get('file')
    if (!(file instanceof File)) return { ok: false, message: 'Choose a file to upload.' }
    await uploadSecureFile(ctx, contextType, contextId, file)
    refresh(path)
  }, 'File uploaded.')
}

export async function removeSecureFileAction(fileId: string, path: string, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await removeSecureFile(ctx, fileId); refresh(path) }, 'File removed.')
}

export async function clearSecureFileAction(fileId: string, path: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await clearSecureFile(ctx, fileId, String(fd.get('reason') ?? '')); refresh(path) }, 'File cleared. The clearance is recorded in the audit log.')
}
