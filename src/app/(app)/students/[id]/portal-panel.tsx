import { fmtDateTime } from '@/components/format'
import { Badge, Card } from '@/components/ui'
import type { Ctx } from '@/server/services/base'
import { portalAccount, studentPublications } from '@/server/services/portal-accounts'
import { AccountStatusForm, IssueLinkButton, PublishForm, UnpublishForm } from './portal-forms'

// delivery status of the secure portal link email (finding N-7); the link itself is never shown
const EMAIL_STATUS = { queued: 'waiting to be sent', sending: 'being sent', sent: 'sent', failed: 'could not be sent – issue a new link',
  skipped: 'not sent (email not configured)', test: 'not sent (test mode)', expired: 'expired before sending', revoked: 'replaced or cancelled' } as const
const STATUS = { invited: ['Set-up link sent – no password yet', 'amber'], active: ['Active', 'green'], disabled: ['Disabled', 'red'] } as const

/** Student portal password account (overview side column). */
export async function PortalAccountCard({ ctx, studentId, emailVerified, editable }: { ctx: Ctx; studentId: string; emailVerified: boolean; editable: boolean }) {
  const { account: a, canManage, lastEmail } = await portalAccount(ctx, studentId)
  if (!a && !canManage) return null
  return (
    <Card title="Student portal account">
      {!a ? (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">No password account yet. The student can still sign in with a one-time code.</p>
          {!emailVerified && <p className="text-xs text-amber-800">The email address is not verified, so the set-up link will be shown to you to hand over personally.</p>}
          {editable && <IssueLinkButton studentId={studentId} label="Create account & issue set-up link" />}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="flex flex-wrap items-center gap-2"><Badge tone={STATUS[a.status][1]}>{STATUS[a.status][0]}</Badge>{a.locked && <Badge tone="red">Locked (15 min)</Badge>}</p>
          <dl className="space-y-1 text-xs text-slate-600">
            <div>Created {fmtDateTime(a.created_at)}</div>
            {a.password_set_at && <div>Password set {fmtDateTime(a.password_set_at)}</div>}
            <div>Last sign-in {a.last_login_at ? fmtDateTime(a.last_login_at) : 'never'}</div>
            {a.open_link_expires && <div>An unused link is valid until {fmtDateTime(a.open_link_expires)}</div>}
            {lastEmail && <div>Last link email: {EMAIL_STATUS[lastEmail.status]} ({fmtDateTime(lastEmail.finished_at ?? lastEmail.created_at)}){lastEmail.last_error && lastEmail.status !== 'queued' ? ` – ${lastEmail.last_error}` : ''}</div>}
            {a.disabled_reason && <div className="text-red-700">Disabled: {a.disabled_reason}</div>}
          </dl>
          {canManage && editable && (
            <div className="flex flex-wrap items-start gap-2 border-t border-slate-100 pt-3">
              {a.status !== 'disabled' && <IssueLinkButton studentId={studentId} label={a.status === 'active' ? 'Issue password reset link' : 'Re-issue set-up link'} />}
              <AccountStatusForm studentId={studentId} enabled={a.status !== 'disabled'} />
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/** Documents published to the portal (Documents tab). */
export async function PublicationsCard({ ctx, studentId, editable, approved }: {
  ctx: Ctx; studentId: string; editable: boolean; approved: { id: string; name: string }[]
}) {
  const { rows, canPublish } = await studentPublications(ctx, studentId)
  const open = new Set(rows.filter((r) => !r.unpublished_at).map((r) => r.student_document_id))
  const candidates = approved.filter((d) => !open.has(d.id))
  if (!rows.length && !canPublish) return null
  return (
    <Card title="Published to the student portal">
      <div className="space-y-4 text-sm">
        {rows.length === 0 ? <p className="text-slate-600">Nothing published yet. Only approved documents can be published; every download is logged.</p> : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-start justify-between gap-2 py-2 ${r.unpublished_at ? 'opacity-60' : ''}`}>
                <div>
                  <p className="font-medium">{r.title} {r.unpublished_at ? <Badge>Withdrawn</Badge> : <Badge tone="green">Visible to the student</Badge>}</p>
                  <p className="text-xs text-slate-500">Published {fmtDateTime(r.published_at)} by {r.publisher ?? '—'} · downloaded {r.downloads}×{r.last_download && ` (last ${fmtDateTime(r.last_download)})`}
                    {r.unpublish_reason && ` · withdrawn: ${r.unpublish_reason}`}</p>
                </div>
                {!r.unpublished_at && canPublish && editable && <UnpublishForm studentId={studentId} publicationId={r.id} />}
              </li>))}
          </ul>
        )}
        {canPublish && editable && candidates.length > 0 && (
          <details className="rounded-xl border border-dashed border-slate-300 p-3">
            <summary className="cursor-pointer font-medium">Publish an approved document</summary>
            <ul className="mt-3 space-y-3">
              {candidates.map((d) => <li key={d.id}><p className="mb-1 text-xs font-semibold text-slate-600">{d.name}</p><PublishForm studentId={studentId} documentId={d.id} defaultTitle={d.name} /></li>)}
            </ul>
          </details>
        )}
      </div>
    </Card>
  )
}
