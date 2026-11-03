import { fmtDate, fmtDateTime, label } from '@/components/format'
import { Badge, Card, type Tone } from '@/components/ui'
import type { Ctx } from '@/services/base'
import { getDocumentAttestation } from '@/services/attestation'
import { CancelAttestationForm, StartAttestationForm, StepForms } from './attestation-forms'

const STEP_TONE: Record<string, Tone> = { pending: 'slate', in_progress: 'blue', completed: 'green', not_required: 'slate', exception: 'amber' }
const STEP_LABEL: Record<string, string> = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed', not_required: 'Not required', exception: 'Skipped (exception)' }

export async function AttestationPanel({ ctx, studentId, docId, destination }: { ctx: Ctx; studentId: string; docId: string; destination: string | null }) {
  const a = await getDocumentAttestation(ctx, docId)
  if (!a) return null
  const { state, routes, current, steps, files, perms } = a
  const nextStep = steps.find((s) => !['completed', 'not_required', 'exception'].includes(s.status))
  return (
    <Card title={<span className="flex flex-wrap items-center gap-2">Attestation / apostille
      {state.state === 'ready' && <Badge tone="blue">Ready for attestation</Badge>}
      {state.state === 'processing' && <Badge tone="purple">Processing · {state.done}/{state.total}</Badge>}
      {state.state === 'completed' && <Badge tone="green">Completed</Badge>}</span>} className="mt-6">
      {!state.state && (
        <p className="text-sm text-slate-600">
          {a.doc.status !== 'approved'
            ? 'Attestation can start once the current version has been verified and approved by a manager.'
            : <>No approved route matches this document (destination {destination ?? 'not set'}, issued in {a.doc.issuing_country ?? <strong>issuing country not set</strong>}).
              Set the certificate issuing country on the student&apos;s Documents tab, or ask the MD/administrator to configure a route.</>}
        </p>
      )}
      {state.state === 'ready' && (perms.process
        ? <StartAttestationForm studentId={studentId} docId={docId}
            routes={routes.map((r) => ({ id: r.id, label: `${r.name} (v${r.version}, ${label(r.route_type)})`, stages: r.stage_names }))} />
        : <p className="text-sm text-slate-600">Ready for attestation. Staff with attestation permission can start it.</p>)}
      {current && (
        <div className="space-y-4">
          <p className="text-sm">Route: <strong>{current.route_name}</strong> · version {current.route_version} · {label(current.route_type)} · started {fmtDateTime(current.started_at)} by {current.starter} (file v{current.file_version})</p>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s.id} className={`rounded-md border p-3 ${s.id === nextStep?.id ? 'border-brand-600' : 'border-slate-200'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{i + 1}. {s.name} {!s.is_mandatory && <span className="text-xs font-normal text-slate-500">(optional)</span>}</p>
                    <p className="text-xs text-slate-600">{[s.authority_name, s.responsible_department && `Dept: ${s.responsible_department}`, s.assignee && `Responsible: ${s.assignee}`,
                      s.expected_days != null && `~${s.expected_days} days`].filter(Boolean).join(' · ')}</p>
                    {s.guidance && <p className="mt-1 text-xs text-slate-600">{s.guidance}</p>}
                    <p className="mt-1 text-xs text-slate-600">{[s.processing_date && `Processed ${fmtDate(s.processing_date)}`, s.reference_no && `Ref ${s.reference_no}`,
                      s.completed_at && `Done ${fmtDateTime(s.completed_at)} by ${s.completer}`].filter(Boolean).join(' · ')}</p>
                    {s.comments && <p className="text-xs text-slate-700">“{s.comments}”</p>}
                    {s.exception_reason && <p className="text-xs text-amber-800">Exception: {s.exception_reason}</p>}
                    {files.filter((f) => f.step_id === s.id).map((f) => (
                      <p key={f.id} className="text-xs">{perms.file_view ? <a href={`/api/attestation-files/${f.id}`} target="_blank" rel="noopener noreferrer">{f.filename}</a> : f.filename}
                        <span className="text-slate-500"> · {f.uploader} · {fmtDateTime(f.uploaded_at)}</span></p>))}
                  </div>
                  <Badge tone={STEP_TONE[s.status]}>{STEP_LABEL[s.status]}</Badge>
                </div>
                {perms.process && current.status === 'in_progress' && s.id === nextStep?.id && (
                  <StepForms studentId={studentId} docId={docId} canException={perms.exception} staff={a.staff}
                    step={{ id: s.id, status: s.status, is_mandatory: s.is_mandatory, requires_reference: s.requires_reference,
                      requires_supporting_file: s.requires_supporting_file, reference_no: s.reference_no, assigned_to: s.assigned_to }} />
                )}
              </li>
            ))}
          </ol>
          {perms.process && current.status === 'in_progress' && <CancelAttestationForm studentId={studentId} docId={docId} attestationId={current.id} />}
        </div>
      )}
      {a.history.length > (current ? 1 : 0) && (
        <details className="mt-4 text-sm"><summary className="cursor-pointer text-slate-600">Earlier attestations</summary>
          <ul className="mt-2 space-y-1">{a.history.filter((h) => h.id !== current?.id).map((h) => (
            <li key={h.id} className="text-xs">{fmtDateTime(h.started_at)} · {h.route_name} v{h.route_version} · file v{h.file_version} · <strong>{label(h.status)}</strong>
              {h.cancel_reason && ` – ${h.cancel_reason}`}</li>))}
          </ul>
        </details>
      )}
    </Card>
  )
}
