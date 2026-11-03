import type { AuthContext } from '../lib/auth/context'
import { type Tx, withUser } from '../lib/db'
import { toServiceError } from '../lib/errors'

export type Ctx = Pick<AuthContext, 'userId' | 'memberships' | 'ip'>

/** Run a unit of work as the current user. DB errors become safe ServiceErrors. */
export async function run<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await withUser(ctx.userId, fn, { ip: ctx.ip })
  } catch (e) {
    throw toServiceError(e)
  }
}

export const PAGE_SIZE = 25

export function pageOf(n: unknown) {
  const p = Number(n)
  return Number.isInteger(p) && p > 0 && p < 10000 ? p : 1
}

export function audit(tx: Tx, action: string, entityType: string, entityId: string | null,
  opts: { orgId?: string | null; studentId?: string | null; after?: unknown; outcome?: 'success' | 'denied' | 'failure'; metadata?: unknown } = {}) {
  return tx`select app.audit(${action}, ${entityType}, ${entityId}, ${opts.orgId ?? null}, ${opts.studentId ?? null},
                             null, ${opts.after === undefined ? null : tx.json(opts.after as never)},
                             ${opts.outcome ?? 'success'}, ${tx.json((opts.metadata ?? {}) as never)}, null)`
}
