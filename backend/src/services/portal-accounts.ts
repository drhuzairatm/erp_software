import { encryptSecret } from '../lib/auth/mfa'
import { appUrl } from '../lib/email'
import { hashToken, newTokenValue } from '../lib/auth/tokens'
import { invalid } from '../lib/errors'
import { type Ctx, run } from './base'

const UUID = /^[0-9a-f-]{36}$/i

export interface PortalAccountInfo {
  status: 'invited' | 'active' | 'disabled'; created_at: Date; password_set_at: Date | null; last_login_at: Date | null
  locked: boolean; disabled_reason: string | null; open_link_expires: Date | null; can_manage: boolean
}
/** Delivery status of the latest portal link email (secure queue, finding N-7). Never contains the link. */
export interface PortalLinkEmailStatus {
  kind: 'portal_account_setup' | 'portal_password_reset'; status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'test' | 'expired' | 'revoked'
  created_at: Date; finished_at: Date | null; attempts: number; last_error: string | null
}

export async function portalAccount(ctx: Ctx, studentId: string) {
  if (!UUID.test(studentId)) return { account: null, canManage: false, lastEmail: null }
  return run(ctx, async (tx) => {
    const [a] = await tx<PortalAccountInfo[]>`select * from app.portal_account_info(${studentId})`
    const [{ m }] = await tx<{ m: boolean }[]>`select app.can_on_student(${studentId}, 'portal.accounts.manage') as m`
    const [e] = await tx<PortalLinkEmailStatus[]>`select * from app.portal_email_status(${studentId})`
    return { account: a ?? null, canManage: m, lastEmail: e ?? null }
  })
}

/**
 * Creates the account if needed and issues a set-up/reset link. Returns the link only when it was NOT e-mailed (the
 * issuing staff member hands it over personally). Emailed links go to the secure queue ENCRYPTED (finding N-7): no staff
 * member, and not the application role, can read them there.
 */
export async function issuePortalLink(ctx: Ctx, studentId: string) {
  const token = newTokenValue()
  const link = appUrl(`/portal/password?token=${token}`)
  const [r] = await run(ctx, (tx) => tx<{ mode: 'emailed' | 'link' }[]>`select app.issue_portal_account_link(${studentId}, ${hashToken(token)}, ${encryptSecret(link)}) as mode`)
  return r.mode === 'emailed' ? { mode: 'emailed' as const } : { mode: 'link' as const, link }
}

export async function setPortalAccountEnabled(ctx: Ctx, studentId: string, enabled: boolean, reason?: string) {
  if (!enabled && !reason?.trim()) throw invalid('Give the reason for disabling.', { reason: ['Required.'] })
  await run(ctx, (tx) => tx`select app.set_portal_account_status(${studentId}, ${enabled}, ${reason?.trim() || null})`)
}

// ---------------------------------------------------------------- publications
export async function studentPublications(ctx: Ctx, studentId: string) {
  return run(ctx, async (tx) => {
    const rows = await tx<{ id: string; student_document_id: string; title: string; published_at: Date; publisher: string | null;
      unpublished_at: Date | null; unpublish_reason: string | null; downloads: number; last_download: Date | null }[]>`
      select p.id, p.student_document_id, p.title, p.published_at, u.full_name as publisher, p.unpublished_at, p.unpublish_reason,
             (select count(*)::int from portal_downloads d where d.publication_id = p.id) as downloads,
             (select max(downloaded_at) from portal_downloads d where d.publication_id = p.id) as last_download
        from portal_publications p left join user_profiles u on u.id = p.published_by
       where p.student_id = ${studentId} order by p.published_at desc`
    const [{ can }] = await tx<{ can: boolean }[]>`select app.can_on_student(${studentId}, 'documents.publish') as can`
    return { rows, canPublish: can }
  })
}

export async function publishDocument(ctx: Ctx, documentId: string, title?: string) {
  if (!UUID.test(documentId)) throw invalid('Unknown document.')
  const [r] = await run(ctx, (tx) => tx<{ id: string }[]>`select app.publish_document(${documentId}, ${title?.trim() || null}) as id`)
  return r.id
}

export async function unpublishDocument(ctx: Ctx, publicationId: string, reason?: string) {
  if (!reason?.trim()) throw invalid('Give the reason for withdrawing.', { reason: ['Required.'] })
  await run(ctx, (tx) => tx`select app.unpublish_document(${publicationId}, ${reason.trim()})`)
}
