'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import { commitImport, previewImport } from '@/services/student-import'
import { runAction } from './run-action'

function read(fd: FormData) {
  return { orgId: String(fd.get('orgId') ?? ''), csv: String(fd.get('csv') ?? ''), fileName: String(fd.get('fileName') ?? 'import.csv') }
}

export async function previewImportAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const { orgId, csv } = read(fd)
  if (!csv) return { ok: false, message: 'Choose a CSV file first.' }
  return runAction(async () => {
    const analysis = await previewImport(ctx, orgId, csv)
    return { ok: true, data: { analysis } }
  })
}

export async function commitImportAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const { orgId, csv, fileName } = read(fd)
  return runAction(async () => {
    const result = await commitImport(ctx, orgId, csv, { includeDuplicates: fd.get('includeDuplicates') === 'yes', fileName })
    revalidatePath('/students')
    return { ok: true, message: `Imported ${result.imported.length} student${result.imported.length === 1 ? '' : 's'}; skipped ${result.skipped.length}.`, data: { result } }
  })
}
