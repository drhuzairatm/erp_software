import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDateTime, label } from '@/components/format'
import { Card, EmptyState, PageHeader, StatusBadge } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { getDocumentReview } from '@/server/services/documents'
import { AttestationPanel } from './attestation-panel'
import { ReviewWorkspace } from './review-workspace'

export const metadata: Metadata = { title: 'Document review' }

export default async function DocumentReviewPage({ params, searchParams }: { params: Promise<{ id: string; docId: string }>; searchParams: Promise<{ file?: string }> }) {
  const { id, docId } = await params
  const { file } = await searchParams
  const ctx = await requireUser()
  const r = await getDocumentReview(ctx, docId, file)
  if (!r || r.doc.student_id !== id) notFound()
  const { doc } = r
  return (
    <>
      <PageHeader back={{ href: `/students/${id}?tab=documents`, label: `${doc.student_name} · documents` }}
        title={<span className="flex flex-wrap items-center gap-2">{doc.type_name}{doc.label && ` – ${doc.label}`} <StatusBadge status={doc.status} /></span>}
        description={<span className="flex flex-wrap gap-x-3 text-sm">
          <span className="font-mono">{doc.student_code}</span>
          {doc.verifier_name && <span>Verified by {doc.verifier_name}</span>}
          {doc.submitter_name && <span>Submitted by {doc.submitter_name}</span>}
          {doc.approver_name && doc.status === 'approved' && <span>Approved by {doc.approver_name}</span>}
          {doc.rejection_reason && <span className="text-red-700">Reason: {doc.rejection_reason}</span>}
        </span>}
        actions={r.perms.download && r.viewFile && <a className="btn-secondary" href={`/api/files/${r.viewFile.id}`} target="_blank" rel="noopener noreferrer">Download original</a>} />

      {!r.perms.file_view ? (
        <Card><p className="text-sm text-slate-600">Your role can see the status of this document but cannot open the file.</p></Card>
      ) : (
        <>
          {r.files.length > 1 && (
            <nav aria-label="Versions" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600">Version:</span>
              {r.files.map((f) => (
                <Link key={f.id} href={`?file=${f.id}`} aria-current={r.viewFile?.id === f.id ? 'page' : undefined}
                  className={`rounded-full px-3 py-0.5 no-underline ring-1 hover:no-underline ${r.viewFile?.id === f.id ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200'}`}>
                  v{f.version}{f.id === doc.current_file_id ? ' (current)' : ''}
                </Link>
              ))}
            </nav>
          )}
          <ReviewWorkspace studentId={id} docId={docId} status={doc.status}
            file={r.viewFile && { id: r.viewFile.id, version: r.viewFile.version, mime_type: r.viewFile.mime_type, original_filename: r.viewFile.original_filename }}
            isCurrentFile={!!r.viewFile && r.viewFile.id === doc.current_file_id}
            requirements={r.requirements} annotations={r.annotations} perms={r.perms} me={r.me}
            verifiedBy={doc.verified_by} submittedBy={doc.submitted_by} unmet={r.unmet} />
        </>
      )}

      <AttestationPanel ctx={ctx} studentId={id} docId={docId} destination={r.destination} />

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Status history" padded={false}>
          {r.reviews.length === 0 ? <EmptyState title="No history" /> : (
            <ol className="divide-y divide-slate-100">{r.reviews.map((h) => (
              <li key={h.id} className="px-4 py-2 text-sm">
                <span className="text-xs text-slate-500">{fmtDateTime(h.reviewed_at)} · {h.reviewer}{h.file_version ? ` · v${h.file_version}` : ''}</span>
                <p>{label(h.from_status)} → <strong>{label(h.to_status)}</strong>{h.reason && <span className="text-slate-600"> — {h.reason}</span>}</p>
              </li>))}
            </ol>
          )}
        </Card>
        <Card title="Verification record (cannot be edited or deleted)" padded={false}>
          {r.verifications.length === 0 ? <EmptyState title="No checks recorded" /> : (
            <ol className="max-h-96 divide-y divide-slate-100 overflow-y-auto">{r.verifications.map((v) => (
              <li key={v.id} className="px-4 py-2 text-sm">
                <span className="text-xs text-slate-500">{fmtDateTime(v.verified_at)} · {v.by} · file v{v.file_version} · rule v{v.rule_version}
                  {v.detected !== null && ` · text ${v.detected ? 'found' : 'not found'} automatically`}</span>
                <p><strong>{label(v.result)}</strong>: {v.requirement_text}{v.comment && <span className="text-slate-600"> — {v.comment}</span>}</p>
              </li>))}
            </ol>
          )}
        </Card>
      </div>
    </>
  )
}
