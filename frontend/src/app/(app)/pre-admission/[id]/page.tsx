import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDateTime, label } from '@/components/format'
import { ScanBadge } from '@/components/scan-badge'
import { Alert, Badge, Card, DL, EmptyState, PageHeader } from '@/components/ui'
import { can } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { getDvr } from '@/services/dvr'
import { AddDocumentsForm, AssignForm, CancelForm, CloseForm, CompleteForm, EditDvrForm, LinkStudentForm, NewVersionForm, RemoveDocumentButton, RequestDocumentForm, ReturnForm, ReviewDocumentForm, SendBackForm, StartButton, SubmitForm } from '../forms'
import { dvrFormOptions } from '../options'
import { DvrResult, DvrStatus, dvrStatusText } from '../shared'

export const metadata: Metadata = { title: 'Verification request' }

export default async function DvrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser()
  const { id } = await params
  const data = await getDvr(ctx, id)
  if (!data) notFound()
  const { request: r, documents, files, reviews, events, changes, reviewers } = data
  const finished = ['closed', 'cancelled'].includes(r.status)
  const underway = r.status === 'under_verification' && r.is_reviewer
  const canSubmit = r.is_owner && ['draft', 'additional_documents_required', 'correction_required', 'returned_to_counselor'].includes(r.status)
  const canAssign = !finished && r.status !== 'draft' && (can(ctx, 'dvr.manage', r.org_id) || can(ctx, 'dvr.review', r.org_id))
  const options = r.is_owner && !finished ? await dvrFormOptions(ctx) : null
  return (
    <>
      <PageHeader title={r.dvr_number} description={`${r.prospect_name} · ${r.org_name}`} back={{ href: '/pre-admission', label: 'Pre-admission' }} actions={<DvrStatus status={r.status} />} />
      <div className="mb-4 space-y-3">
        <Alert tone="blue">A preliminary assessment only, not a guarantee of admission or a visa. This request is not a student registration.</Alert>
        {r.reverification_required && <Alert tone="amber">Country, university, programme or intake changed after review began. This request needs re-verification.</Alert>}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card title="Request">
            <DL items={[
              ['Phone', r.prospect_phone ?? '—'], ['Email', r.prospect_email ?? '—'], ['Destination country', r.country], ['University', r.university ?? '—'], ['Programme', r.programme ?? '—'],
              ['Intake', r.intake ?? '—'], ['Academic year', r.academic_year ?? '—'], ['Counsellor', r.counsellor ?? '—'], ['Remarks', r.remarks ?? '—'], ['Special instructions', r.special_instructions ?? '—'],
            ]} />
            {options && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Edit details</summary><div className="mt-3"><EditDvrForm id={r.id} options={options} values={r} /></div></details>}
          </Card>
          <Card title={`Documents (${documents.length})`}>
            {documents.length === 0 ? <EmptyState title="No documents yet" /> : <ul className="space-y-4">{documents.map((d) => {
              const versions = files.filter((f) => f.context_id === d.id)
              const history = reviews.filter((x) => x.document_id === d.id)
              const needsUpload = d.result === 'missing_document' || d.result === 'correction_required'
              return (
                <li key={d.id} className="rounded-md border border-slate-200 p-3 text-sm" data-testid="dvr-document">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 font-semibold wrap-anywhere">{d.category}{d.label ? ` · ${d.label}` : ''}</span><DvrResult result={d.result} /></div>
                  {d.result_notes && <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-slate-700">{d.result_notes}</p>}
                  {versions.length === 0 ? <p className="hint mt-2">No file yet.</p> : <ol className="mt-2 divide-y divide-slate-100">{[...versions].reverse().map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className="min-w-0"><a href={`/api/secure-files/${f.id}`} target="_blank" rel="noopener" className="wrap-anywhere">{f.original_filename}</a>
                      <span className="block text-xs text-slate-500">Version {versions.indexOf(f) + 1} · {f.uploader ?? 'Unknown'} · {fmtDateTime(f.uploaded_at)}</span></span><ScanBadge status={f.scan_status} /></li>
                  ))}</ol>}
                  {history.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Review history ({history.length})</summary><ul className="mt-1 space-y-1 text-xs text-slate-600">{history.map((h) => <li key={h.id} className="wrap-anywhere">{fmtDateTime(h.reviewed_at)} · {h.reviewer ?? 'Unknown'} · {label(h.result)}{h.notes ? `: ${h.notes}` : ''}</li>)}</ul></details>}
                  {underway && <div className="mt-3 border-t border-slate-100 pt-3"><ReviewDocumentForm id={r.id} documentId={d.id} current={d.result} label={d.category} /></div>}
                  {r.can_change_documents && <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-slate-100 pt-3"><div className="min-w-0 flex-1"><NewVersionForm id={r.id} documentId={d.id} required={needsUpload} /></div>{(r.status === 'draft' || (versions.length === 0 && history.length === 0)) && <RemoveDocumentButton id={r.id} documentId={d.id} />}</div>}
                </li>)
            })}</ul>}
            {r.can_change_documents && options && <div className="mt-4 border-t border-slate-100 pt-4"><h3 className="mb-2 text-sm font-semibold">Add documents</h3><AddDocumentsForm id={r.id} documentTypes={options.documentTypes} /></div>}
            {underway && <div className="mt-4 border-t border-slate-100 pt-4"><h3 className="mb-2 text-sm font-semibold">A document was not supplied</h3><RequestDocumentForm id={r.id} documentTypes={[]} /></div>}
          </Card>
          {underway && <Card title="Finish this review"><div className="grid grid-cols-1 gap-6 md:grid-cols-2"><div><h3 className="mb-2 text-sm font-semibold">Send back or hold</h3><SendBackForm id={r.id} /></div><div><h3 className="mb-2 text-sm font-semibold">Assessment</h3><CompleteForm id={r.id} current={r.overall_result} notes={r.overall_notes} /></div></div></Card>}
        </div>
        <div className="min-w-0 space-y-4">
          <Card title="Assessment">
            <div className="flex flex-wrap items-center gap-2"><DvrResult result={r.overall_result} /></div>
            {r.overall_notes && <p className="mt-2 whitespace-pre-wrap text-sm wrap-anywhere text-slate-700">{r.overall_notes}</p>}
            {r.status === 'verification_completed' && r.is_reviewer && <div className="mt-3"><ReturnForm id={r.id} /></div>}
          </Card>
          <Card title="Reviewer">
            <p className="text-sm">{r.reviewer ?? 'No reviewer yet'}{r.assigned_at ? <span className="block text-xs text-slate-500">Assigned {fmtDateTime(r.assigned_at)}</span> : null}{r.started_at ? <span className="block text-xs text-slate-500">Started {fmtDateTime(r.started_at)}</span> : null}</p>
            {canAssign && <div className="mt-3"><AssignForm id={r.id} reviewers={reviewers.filter((x) => x.id !== r.counsellor_id)} current={r.reviewer_id} withReason={!!r.reviewer_id} /></div>}
            {r.is_reviewer && ['assigned', 'resubmitted', 'pending_further_review'].includes(r.status) && <div className="mt-3"><StartButton id={r.id} /></div>}
          </Card>
          {canSubmit && <Card title={r.status === 'draft' ? 'Send to Documentation' : 'Send back to Documentation'}><SubmitForm id={r.id} resubmit={r.status !== 'draft'} /></Card>}
          {(r.linked_student_id || (r.is_owner && ['verification_completed', 'returned_to_counselor', 'closed'].includes(r.status))) && (
            <Card title="Student registration">
              {r.linked_student_id ? <p className="text-sm">Linked to <Link href={`/students/${r.linked_student_id}`} className="font-mono">{r.linked_code}</Link></p> : (<>
                <p className="hint mb-2">Registration is a separate step and never happens automatically. Register the student first, then link them here. The DVR number stays on this request.</p>
                <p className="mb-3 text-sm"><Link href="/students/new">Open student registration</Link></p>
                <LinkStudentForm id={r.id} /></>)}
            </Card>)}
          {!finished && (r.is_owner || r.is_reviewer) && <Card title="Close or cancel"><div className="space-y-3">{['verification_completed', 'returned_to_counselor'].includes(r.status) && <CloseForm id={r.id} />}{r.is_owner && <CancelForm id={r.id} />}</div></Card>}
          <Card title="History">
            {changes.length > 0 && <div className="mb-3"><h3 className="mb-1 text-sm font-semibold">Changes to the request</h3><ul className="space-y-1 text-xs text-slate-600">{changes.map((c) => <li key={c.id} className="wrap-anywhere">{fmtDateTime(c.changed_at)} · {c.changer ?? 'Unknown'} · {c.field}: {c.old_value ?? '—'} → {c.new_value ?? '—'}{c.needs_reverification ? <span className="ml-1"><Badge tone="amber">Re-verification</Badge></span> : null}</li>)}</ul></div>}
            <ul className="space-y-2 text-xs text-slate-600">{events.map((e) => <li key={e.id} className="wrap-anywhere"><span className="font-medium text-slate-800">{label(e.action)}</span>{e.to_status && e.to_status !== e.from_status ? ` → ${dvrStatusText(e.to_status)}` : ''}<span className="block">{fmtDateTime(e.at)} · {e.actor ?? 'System'}</span>{e.note && <span className="block whitespace-pre-wrap text-slate-700">{e.note}</span>}</li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  )
}
