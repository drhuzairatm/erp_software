import { can, canAny } from '../auth/context'
import { forbidden, invalid } from '../errors'
import { type Ctx, run } from './base'

const UUID = /^[0-9a-f-]{36}$/i
export const canSeeSecurity = (ctx: Ctx) => canAny(ctx, ['security.alerts'])

export interface SecurityAlert {
  id: string; kind: string; severity: 'info' | 'warning' | 'high' | 'critical'; title: string; details: Record<string, unknown>
  occurrences: number; created_at: Date; last_seen_at: Date; actor_name: string | null; org_name: string | null
  acknowledged_at: Date | null; acknowledged_by_name: string | null; ack_note: string | null
}

export async function listAlerts(ctx: Ctx, f: { open?: boolean; severity?: string } = {}) {
  if (!canSeeSecurity(ctx)) throw forbidden()
  const sev = ['info', 'warning', 'high', 'critical'].includes(f.severity ?? '') ? f.severity! : null
  return run(ctx, (tx) => tx<SecurityAlert[]>`
    select a.id, a.kind, a.severity, a.title, a.details, a.occurrences, a.created_at, a.last_seen_at, u.full_name as actor_name, o.name as org_name,
           a.acknowledged_at, k.full_name as acknowledged_by_name, a.ack_note
      from security_alerts a left join user_profiles u on u.id = a.actor_user_id left join organizations o on o.id = a.org_id
      left join user_profiles k on k.id = a.acknowledged_by
     where (${!f.open} or a.acknowledged_at is null) and (${sev}::text is null or a.severity = ${sev})
     order by (a.acknowledged_at is null) desc, case a.severity when 'critical' then 0 when 'high' then 1 when 'warning' then 2 else 3 end, a.last_seen_at desc
     limit 300`)
}

export async function openAlertCounts(ctx: Ctx) {
  if (!canSeeSecurity(ctx)) return null
  const [r] = await run(ctx, (tx) => tx<{ total: number; urgent: number }[]>`
    select count(*)::int as total, count(*) filter (where severity in ('high', 'critical'))::int as urgent from security_alerts where acknowledged_at is null`)
  return r
}

export async function acknowledgeAlert(ctx: Ctx, id: string, note?: string) {
  if (!UUID.test(id)) throw invalid('Unknown alert.')
  await run(ctx, (tx) => tx`select app.acknowledge_security_alert(${id}, ${note ?? null})`)
}

export interface LoginEvent { occurred_at: Date; event: string; outcome: string; ip: string | null }
export interface ActiveSession { created_at: Date; last_seen_at: Date; ip: string | null; user_agent: string | null; two_factor_pending: boolean }

/** Login history and active sessions: own, people within your authority, or security.alerts holders (same companies). */
export async function loginActivity(ctx: Ctx, userId: string, limit = 50) {
  if (!UUID.test(userId)) return null
  return run(ctx, async (tx) => {
    const [{ ok }] = await tx<{ ok: boolean }[]>`select app.can_see_login_history(${userId}) as ok`
    if (!ok) return null
    const history = await tx<LoginEvent[]>`select * from app.login_history(${userId}, ${limit})`
    const sessions = await tx<ActiveSession[]>`select * from app.active_sessions(${userId})`
    return { history, sessions }
  })
}

/** MANUAL security clearance of a file that was not virus-scanned (not equivalent to a scan; audited, alerted). */
export async function clearFileManually(ctx: Ctx, fileId: string, reason: string) {
  if (!UUID.test(fileId)) throw invalid('Unknown file.')
  if ((reason ?? '').trim().length < 10) throw invalid('Give the reason for the manual clearance (at least 10 characters).', { reason: ['At least 10 characters.'] })
  await run(ctx, (tx) => tx`select app.clear_file_manually(${fileId}, ${reason.trim()})`)
}
export const canClearFiles = (ctx: Ctx, orgId?: string) => can(ctx, 'documents.security_clear', orgId)
