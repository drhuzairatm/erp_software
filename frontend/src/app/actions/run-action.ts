import 'server-only'
import { after } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { processQueue } from '@/lib/notifications/dispatcher'
import type { ActionResult } from '@/components/action-types'
import { toServiceError } from '@/lib/errors'

/** Execute a server action body and convert errors into a safe ActionResult. */
export async function runAction(fn: () => Promise<ActionResult | void>, successMessage?: string): Promise<ActionResult> {
  try {
    const r = await fn()
    // Actions may queue notifications (stage changes, document reviews…): send them after the response.
    after(() => processQueue(25).catch((e) => console.error(JSON.stringify({ level: 'error', msg: 'notification dispatch failed', error: String(e) }))))
    return r ?? { ok: true, message: successMessage }
  } catch (e) {
    if (isRedirect(e)) after(() => processQueue(25).catch(() => {}))
    unstable_rethrow(e) // let redirect()/notFound() work
    const err = toServiceError(e)
    return { ok: false, message: err.message, fieldErrors: err.fieldErrors }
  }
}

function isRedirect(e: unknown) {
  return typeof e === 'object' && e !== null && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')
}
