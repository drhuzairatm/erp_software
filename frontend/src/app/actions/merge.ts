'use server'

import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import { buildMergedPdf } from '@/services/merge'
import { runAction } from './run-action'

/** Check step: processes the selection without producing a file and reports pages, warnings and problems. */
export async function checkMergeAction(studentId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const r = await buildMergedPdf(ctx, studentId, fd.getAll('files').map(String), {
      universityId: String(fd.get('universityId') ?? '') || null, purpose: String(fd.get('purpose') ?? ''), allowUnapproved: true, mode: 'check',
    })
    return { ok: r.check.ok, message: r.check.ok ? `Ready: ${r.check.items.length} document(s), ${r.check.pages} page(s).` : r.check.error, data: { check: r.check } }
  })
}
