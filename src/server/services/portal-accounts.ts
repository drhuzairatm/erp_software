import { appUrl } from '../email'
import { hashToken, newTokenValue } from '../auth/tokens'
import { invalid } from '../errors'
import { type Ctx, run } from './base'

const UUID = /^[0-9a-f-]{36}$/i

export interface PortalAccountInfo {
  status: 'invited' | 'active' | 'disabled'; created_at: Date; password_set_at: Date | null; last_login_at: Date | null
  locked: boolean; disabled_reason: string | null; open_link_expires: Date | null; can_manage: boolean
}

export async function portalAccount(ctx: Ctx, studentId: string) {
  if (!UUID.test(studentId)) return { account: null, canManage: false }
  return run(ctx, async (tx) => {
    const [a] = await tx<PortalAccountInfo[]>`select * from app.portal_account_info(${studentId})`
    const [{ m }] = await tx<{ m: boolean }[]>`select app.can_on_student(${studentId}, 'portal.accounts.manage') as m`
    return { account: a ?? null, canManage: m }
  })
}

/** Creates the account if needed and issues a set-up/reset link. Returns the link only when it was NOT e-mailed (staff hand it over). */
export async function issuePortalLink(ctx: Ctx, studentId: string) {
  const token = newTokenValue()
  const link = appUrl(`/portal/password?token=${token}`)
  const [r] = await run(ctx, (tx) => tx<{ mode: 'emailed' | 'link' }[]>`select app.issue_portal_account_link(${studentId}, ${hashToken(token)}, ${link}) as mode`)
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
