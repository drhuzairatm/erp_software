import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDate, fmtDateTime, fmtMoney, label, todayISO } from '@/components/format'
import { Alert, Badge, Card, DemoBadge, DL, EmptyState, PageHeader, PriorityBadge, StatusBadge } from '@/components/ui'
import { can } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { getChecklist } from '@/server/services/documents'
import { getLookups } from '@/server/services/lookups'
import { studentLedger } from '@/server/services/payments'
import { assignableStaff, getNotes, getStudent, getTimeline, type StudentProfile } from '@/server/services/students'
import { listTasks, taskAssignees } from '@/server/services/tasks'
import type { Ctx } from '@/server/services/base'
import { getConsents, listMessages } from '@/server/services/notifications'
import { ConsentForm } from '@/app/(app)/notifications/message-forms'
import { MessageTable } from '@/app/(app)/notifications/message-table'
import { AdmissionForm, ArchiveForm, AssignmentForm, FollowupForm, MergeForm, NoteForm, StageChangeForm, VisaForm } from './panels'
import { AddChecklistItemForm, CustodyForm, DocumentDetailsForm, PaymentForm, QuickTaskForm, ReverseForm, UploadForm, VerifyForm } from './tab-forms'

export const metadata: Metadata = { title: 'Student profile' }

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'documents', label: 'Documents', perm: 'documentsRead' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'payments', label: 'Payments', perm: 'paymentsRead' },
  { key: 'notes', label: 'Notes & follow-ups', perm: 'notesRead' },
  { key: 'messages', label: 'Messages', perm: 'messages' },
  { key: 'timeline', label: 'Timeline' },
] as const

export default async function StudentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; created?: string; updated?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await requireUser()
  const profile = await getStudent(ctx, id)
  if (!profile) notFound()
  const { student: s, permissions: p } = profile
  const tabs = TABS.filter((t) => !('perm' in t) || p[t.perm as keyof typeof p])
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? 'overview'

  return (
    <>
      <PageHeader
        back={{ href: '/students', label: 'Students' }}
        title={<span className="flex flex-wrap items-center gap-2">{s.full_name} {s.is_demo && <DemoBadge />}</span>}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{s.student_code}</span>·<Badge tone={s.org_code === 'GRD' ? 'purple' : 'blue'}>{s.org_name}</Badge>
          {s.processing_org_name && <span className="text-xs">processed by {s.processing_org_name}</span>}·<span>{s.stage_name}</span><StatusBadge status={s.status} />
          {s.archived_at && <Badge tone="slate">Archived</Badge>}</span>}
        actions={p.update && <Link href={`/students/${id}/edit`} className="btn-secondary">Edit details</Link>}
      />
      <div className="space-y-3">
        {sp.created && <Alert tone="green">Student registered with ID {s.student_code}.</Alert>}
        {sp.updated && <Alert tone="green">Details saved.</Alert>}
        {s.status === 'merged' && <Alert tone="amber" title="Merged record">This record was merged into <Link href={`/students/${s.merged_into_id}`}>{s.merged_into_code ?? 'another record'}</Link>. It is kept for history only.</Alert>}
        {s.archived_at && <Alert tone="amber" title="Archived">{s.archive_reason}</Alert>}
      </div>

      <nav aria-label="Student sections" className="mt-4 mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <Link key={t.key} href={`/students/${id}?tab=${t.key}`} aria-current={tab === t.key ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium no-underline hover:no-underline ${tab === t.key ? 'border-brand-600 text-brand-800' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && <Overview ctx={ctx} profile={profile} />}
      {tab === 'documents' && <Documents ctx={ctx} profile={profile} />}
      {tab === 'tasks' && <Tasks ctx={ctx} profile={profile} />}
      {tab === 'payments' && <Payments ctx={ctx} profile={profile} />}
      {tab === 'notes' && <Notes ctx={ctx} profile={profile} />}
      {tab === 'messages' && <Messages ctx={ctx} profile={profile} />}
      {tab === 'timeline' && <Timeline ctx={ctx} id={id} />}
    </>
  )
}

function orgOptions(ctx: Ctx, profile: StudentProfile, perm: string) {
  return profile.access
    .filter((a, i, arr) => arr.findIndex((b) => b.org_id === a.org_id) === i)
    .filter((a) => can(ctx, perm, a.org_id))
    .map((a) => ({ value: a.org_id, label: a.org_name }))
}

async function Overview({ ctx, profile }: { ctx: Ctx; profile: StudentProfile }) {
  const { student: s, permissions: p } = profile
  const staff = p.assign ? await assignableStaff(ctx, s.id) : []
  const today = todayISO()
  const ASSIGN_TYPES = [
    { type: 'manager', label: 'Manager', perm: 'students.assign' },
    { type: 'counsellor', label: 'Counsellor', perm: 'stage.sales' },
    { type: 'documentation', label: 'Documentation staff', perm: 'documents.review' },
    { type: 'visa', label: 'Visa coordinator', perm: 'stage.visa' },
    { type: 'finance', label: 'Finance contact', perm: 'payments.record' },
  ]
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card title="Profile">
          <DL items={[
            ['Phone', s.contact_visible ? s.phone : <span className="text-slate-500">{s.phone_masked ?? '—'} (hidden)</span>],
            ['Email', s.contact_visible ? s.email : <span className="text-slate-500">{s.email_masked ?? '—'} (hidden)</span>],
            ['Date of birth', s.contact_visible ? fmtDate(s.date_of_birth) : <span className="text-slate-500">hidden</span>],
            ['Preferred language', s.preferred_language],
            ['Parent / guardian', s.parent_name ? <>{s.parent_name}{s.contact_visible && (s.parent_phone || s.parent_email) && <span className="block text-xs text-slate-500">{[s.parent_phone, s.parent_email].filter(Boolean).join(' · ')}</span>}</> : null],
            ['Destination', s.country_name], ['Course', s.course_name], ['Visa application country', s.visa_application_country_name],
            ['Preferred university', s.university_name ? <>{s.university_name}{s.campus_name ? ` · ${s.campus_name}` : ''}</> : null],
            ['Lead source', s.lead_source_name], ['Registration date', fmtDate(s.registration_date)],
            ['Workflow', s.workflow_name],
            ['Contracting entity', s.contracting_entity_name ?? 'Not yet decided'], ['Payment recipient', s.payment_recipient_name ?? 'Not yet decided'],
          ]} />
        </Card>
        <Card title="Previous education and academic information">
          <DL items={[
            ['Previous education country', s.previous_education_country_name],
            ['School / institution country', s.school_country_name ?? (s.previous_education_country_name ? 'Same as previous education country' : null)],
            ['School / institution', s.institution_name],
            ['Highest qualification', s.highest_qualification], ['Board / university', s.qualification_board],
            ['Year', s.qualification_year], ['Score', s.qualification_score], ['Entrance / language exam', s.entrance_exam], ['Exam score', s.entrance_score],
          ]} />
          {s.academic_notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{s.academic_notes}</p>}
        </Card>
        <Card title="Stage history" padded={false}>
          {profile.history.length === 0 ? <EmptyState title="No stage changes yet" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>When</th><th>Change</th><th>By</th><th>Reason / next action</th></tr></thead>
              <tbody>{profile.history.map((h) => (
                <tr key={h.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(h.changed_at)}</td>
                  <td>{h.from_name ?? '—'} → <strong>{h.to_name}</strong>{h.warnings.length > 0 && <div className="text-xs text-amber-700">Warnings acknowledged: {h.warnings.join(' ')}</div>}</td>
                  <td>{h.changed_by_name}</td>
                  <td>{h.reason}{h.next_action && <div className="text-xs text-slate-500">Next: {h.next_action}{h.next_action_due ? ` by ${fmtDate(h.next_action_due)}` : ''}</div>}</td>
                </tr>))}
              </tbody>
            </table></div>
          )}
        </Card>
      </div>
      <div className="space-y-6">
        <Card title="Status summary">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-slate-600">Admission stage</dt><dd className="text-right font-medium">{s.stage_name}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-600">Documents</dt>
              <dd className="text-right">{profile.summary.documents.approved}/{profile.summary.documents.required} required approved
                {profile.summary.documents.rejected > 0 && <span className="block text-xs text-red-700">{profile.summary.documents.rejected} rejected</span>}
                {profile.summary.documents.awaiting > 0 && <span className="block text-xs text-slate-500">{profile.summary.documents.awaiting} awaiting review</span>}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-600">Visa</dt><dd><StatusBadge status={s.visa_outcome} /></dd></div>
            {profile.summary.paymentStatus && (
              <div className="flex justify-between gap-2"><dt className="text-slate-600">Payments</dt>
                <dd className="text-right">{profile.summary.balances.filter((b) => b.ledger === 'service').map((b) => <span key={b.currency} className="block">{fmtMoney(b.outstanding, b.currency)} outstanding</span>)}
                  {profile.summary.balances.length === 0 && profile.summary.paymentStatus}</dd></div>
            )}
            <div className="flex justify-between gap-2"><dt className="text-slate-600">Current task</dt>
              <dd className="text-right">{profile.summary.currentTask ? <Link href={`/tasks/${profile.summary.currentTask.id}`}>{profile.summary.currentTask.title}</Link> : '—'}
                {profile.summary.currentTask?.due_date && <span className="block text-xs text-slate-500">due {fmtDate(profile.summary.currentTask.due_date)}{profile.summary.currentTask.assignee ? ` · ${profile.summary.currentTask.assignee}` : ''}</span>}</dd></div>
          </dl>
        </Card>
        <Card title="Passport">
          {s.passport_visible ? (
            <DL items={[['Number', s.passport_number && <span className="font-mono">{s.passport_number}</span>], ['Expiry', fmtDate(s.passport_expiry)], ['Issuing country', s.passport_country_name]]} />
          ) : <p className="text-sm text-slate-600">{s.passport_masked ? <>Recorded ({s.passport_masked}). </> : 'Not recorded. '}Passport details are hidden for your role.</p>}
          {s.passport_visible && s.passport_expiry && s.passport_expiry < today && <p className="mt-2 text-sm font-medium text-red-700">Passport has expired.</p>}
        </Card>
        <Card title="Next action">
          <p className="text-sm">{s.next_action ?? 'None set'}</p>
          {s.next_action_due && <p className={`mt-1 text-sm ${s.next_action_due < today && s.status === 'active' ? 'font-semibold text-red-700' : 'text-slate-600'}`}>Due {fmtDate(s.next_action_due)}</p>}
        </Card>
        {p.stageChange && profile.allowedStages.length > 0 && (
          <Card title="Change stage">
            <StageChangeForm studentId={s.id} current={s.stage_name} stages={profile.allowedStages} />
          </Card>
        )}
        <Card title="Assigned staff">
          <ul className="mb-3 space-y-1 text-sm">
            {ASSIGN_TYPES.map((t) => {
              const a = profile.assignments.find((x) => x.assignment_type === t.type)
              return <li key={t.type} className="flex justify-between gap-2"><span className="text-slate-600">{t.label}</span><span>{a?.full_name ?? '—'}</span></li>
            })}
          </ul>
          {p.assign && (
            <div className="space-y-3 border-t border-slate-100 pt-3">
              {ASSIGN_TYPES.map((t) => {
                const a = profile.assignments.find((x) => x.assignment_type === t.type)
                const options = staff.filter((u) => (t.type === 'counsellor' ? u.org_id === s.originating_org_id : true) && (t.type !== 'manager' || u.role_key === 'manager' || u.role_key === 'md' || u.role_key === 'ceo'))
                  .map((u) => ({ value: `${u.id}|${u.org_id}`, label: `${u.full_name} – ${u.role_name} (${u.org_name})` }))
                return <AssignmentForm key={t.type} studentId={s.id} type={t.type} label={t.label} options={options} current={a ? `${a.user_id}|${a.org_id}` : undefined} />
              })}
            </div>
          )}
        </Card>
        <Card title="Admission & visa">
          <DL items={[
            ['Application ref.', s.university_application_ref], ['Admission letter', fmtDate(s.admission_letter_date)],
            ['Visa appointment', fmtDate(s.visa_appointment_date)], ['Visa outcome', <StatusBadge key="v" status={s.visa_outcome} />],
            ['Visa reference', s.visa_reference],
          ]} />
          {p.admission && <div className="mt-4 border-t border-slate-100 pt-3"><AdmissionForm studentId={s.id} applicationRef={s.university_application_ref} letterDate={s.admission_letter_date} /></div>}
          {p.visa && <div className="mt-4 border-t border-slate-100 pt-3"><VisaForm studentId={s.id} appointment={s.visa_appointment_date} outcome={s.visa_outcome} reference={s.visa_reference} /></div>}
        </Card>
        <Card title="Record information">
          <DL items={[['Created', `${fmtDateTime(s.created_at)} by ${s.created_by_name ?? '—'}`], ['Last updated', `${fmtDateTime(s.updated_at)} by ${s.updated_by_name ?? '—'}`]]} />
        </Card>
        {p.merge && s.status !== 'merged' && <Card title="Merge duplicate"><MergeForm studentId={s.id} code={s.student_code} /></Card>}
        {p.archive && s.status !== 'merged' && <Card title={s.archived_at ? 'Restore' : 'Archive'}><ArchiveForm studentId={s.id} archived={!!s.archived_at} /></Card>}
      </div>
    </div>
  )
}

async function Documents({ ctx, profile }: { ctx: Ctx; profile: StudentProfile }) {
  const s = profile.student
  const [cl, lookups] = await Promise.all([getChecklist(ctx, s.id), getLookups(ctx)])
  const editable = s.status !== 'merged' && !s.archived_at
  const required = cl.items.filter((i) => i.is_required)
  const approved = required.filter((i) => i.effective_status === 'approved').length
  return (
    <div className="space-y-6">
      <Alert tone="blue">
        {approved} of {required.length} required documents approved. Uploads are never approved automatically.
        {' '}Each document is verified by documentation staff, then approved by a different manager.
        {!cl.perms.file_view && ' Your role can see document statuses but cannot open the files.'}
      </Alert>
      <Card padded={false}>
        {cl.items.length === 0 ? <EmptyState title="No checklist items" /> : (
          <ul className="divide-y divide-slate-100">
            {cl.items.map((d) => {
              const versions = cl.files.filter((f) => f.student_document_id === d.id)
              const reviews = cl.reviews.filter((r) => r.student_document_id === d.id)
              const custody = cl.custody.filter((c) => c.student_document_id === d.id)
              return (
                <li key={d.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{d.type_name}{d.label && ` – ${d.label}`} {!d.is_required && <span className="text-xs font-normal text-slate-500">(optional)</span>}
                        {d.requirement_source === 'university' && <> <Badge tone="purple">University requirement</Badge></>}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <StatusBadge status={d.effective_status} />
                        {d.current_version && <span>v{d.current_version} · uploaded {fmtDateTime(d.uploaded_at)} by {d.uploader_name}</span>}
                        {d.reviewed_at && <span>· reviewed by {d.reviewer_name} {fmtDateTime(d.reviewed_at)}</span>}
                        {d.expiry_date && <span>· expires {fmtDate(d.expiry_date)}</span>}
                        {d.issuing_country && <span>· issued in {d.issuing_country}</span>}
                        {d.original_location && <Badge>Original: {label(d.original_location)}</Badge>}
                        {d.attestation_state === 'ready' && <Badge tone="blue">Ready for attestation</Badge>}
                        {d.attestation_state === 'processing' && <Badge tone="purple">Attestation {d.attestation_done}/{d.attestation_total}</Badge>}
                        {d.attestation_state === 'completed' && <Badge tone="green">Attested</Badge>}
                        {d.third_party_ref && <span>· ref {d.third_party_ref}</span>}
                      </div>
                      {['rejected', 'changes_required'].includes(d.effective_status) && d.rejection_reason && <p className="mt-1 text-sm text-red-700">{d.effective_status === 'rejected' ? 'Rejected' : 'Changes required'}: {d.rejection_reason}</p>}
                      {d.status === 'approved' && d.approver_name && <p className="mt-1 text-xs text-green-800">Verified by {d.verifier_name ?? '—'} · approved by {d.approver_name}</p>}
                      {d.notes && <p className="mt-1 text-sm text-slate-600">{d.notes}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {d.current_file_id && (cl.perms.file_view || cl.perms.review || cl.perms.approve) && (
                        <Link className={`btn-sm ${needsAction(d.status, cl.perms) ? 'btn-primary' : 'btn-secondary'}`} href={`/students/${s.id}/documents/${d.id}`}>
                          {needsAction(d.status, cl.perms) ? 'Open review' : 'Open'}</Link>
                      )}
                      {editable && cl.perms.upload && <UploadForm studentId={s.id} documentId={d.id} />}
                    </div>
                  </div>
                  {(versions.length > 0 || reviews.length > 0 || custody.length > 0 || cl.perms.custody || cl.perms.review) && (
                    <details className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
                      <summary className="cursor-pointer text-slate-700">History, location of original and details</summary>
                      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <div>
                          <p className="mb-1 font-medium">File versions</p>
                          {versions.length === 0 ? <p className="text-slate-500">None</p> : <ul className="space-y-1">{versions.map((v) => (
                            <li key={v.id}>v{v.version} · {v.original_filename} · {(v.size_bytes / 1024).toFixed(0)} KB · {fmtDateTime(v.uploaded_at)} by {v.uploader}
                              {cl.perms.file_view && <> · <Link href={`/students/${s.id}/documents/${d.id}?file=${v.id}`}>view</Link></>}
                              {cl.perms.download && <> · <a href={`/api/files/${v.id}`} target="_blank" rel="noopener noreferrer">download</a></>}</li>))}</ul>}
                        </div>
                        <div>
                          <p className="mb-1 font-medium">Review history</p>
                          {reviews.length === 0 ? <p className="text-slate-500">None</p> : <ul className="space-y-1">{reviews.map((r) => (
                            <li key={r.id}>{label(r.from_status)} → <strong>{label(r.to_status)}</strong> · {r.reviewer} · {fmtDateTime(r.reviewed_at)}{r.reason ? ` · ${r.reason}` : ''}</li>))}</ul>}
                        </div>
                        <div>
                          <p className="mb-1 font-medium">Original document location</p>
                          {custody.length === 0 ? <p className="text-slate-500">Not recorded</p> : <ul className="space-y-1">{custody.map((c) => (
                            <li key={c.id}>{label(c.location)}{c.third_party_ref ? ` · ref ${c.third_party_ref}` : ''}{c.note ? ` · ${c.note}` : ''} · {c.recorder} · {fmtDateTime(c.recorded_at)}</li>))}</ul>}
                        </div>
                      </div>
                      {editable && cl.perms.custody && <div className="mt-3 border-t border-slate-200 pt-3"><CustodyForm studentId={s.id} documentId={d.id} current={d.original_location} /></div>}
                      {editable && cl.perms.review && <div className="mt-3 border-t border-slate-200 pt-3"><DocumentDetailsForm studentId={s.id} documentId={d.id} expiry={d.expiry_date} notes={d.notes}
                        issuingCountryId={d.issuing_country_id} countries={lookups.countries.map((c) => ({ value: c.id, label: c.name }))} /></div>}
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      {editable && cl.perms.upload && (
        <Card title="Add a document to the checklist">
          <AddChecklistItemForm studentId={s.id} types={lookups.documentTypes.map((t) => ({ value: t.id, label: t.name }))} />
        </Card>
      )}
    </div>
  )
}

async function Tasks({ ctx, profile }: { ctx: Ctx; profile: StudentProfile }) {
  const s = profile.student
  const [open, done] = await Promise.all([
    listTasks(ctx, profile.accessOrgIds, { studentId: s.id, view: 'open' }),
    listTasks(ctx, profile.accessOrgIds, { studentId: s.id, view: 'completed' }),
  ])
  const createOrgs = orgOptions(ctx, profile, 'tasks.create')
  const staff = createOrgs.length ? await taskAssignees(ctx, createOrgs.map((o) => o.value)) : []
  const rows = [...open.rows, ...done.rows]
  return (
    <div className="space-y-6">
      <Card title="Tasks for this student" padded={false}>
        {rows.length === 0 ? <EmptyState title="No tasks you can see" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Task</th><th>Assigned to</th><th>Status</th><th>Priority</th><th>Due</th></tr></thead>
            <tbody>{rows.map((t) => (
              <tr key={t.id}>
                <td><Link href={`/tasks/${t.id}`}>{t.title}</Link><div className="text-xs text-slate-500">{label(t.task_type)} · {t.org_name}</div></td>
                <td>{t.assignee_name ?? '—'}</td>
                <td><StatusBadge status={t.status} />{t.delay_reason && t.status === 'waiting_external' && <div className="text-xs text-slate-500">on {label(t.delay_reason)}</div>}</td>
                <td><PriorityBadge priority={t.priority} /></td>
                <td className={t.is_overdue ? 'font-semibold text-red-700' : ''}>{fmtDate(t.due_date)}{t.is_overdue && ' (overdue)'}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      {p(profile).tasksCreate && createOrgs.length > 0 && (
        <Card title="New task">
          <QuickTaskForm studentId={s.id} orgs={createOrgs} staff={staff} me={ctx.userId}
            canAssignOrgs={createOrgs.map((o) => o.value).filter((o) => can(ctx, 'tasks.assign', o))} />
        </Card>
      )}
    </div>
  )
}
const p = (profile: StudentProfile) => profile.permissions

/** Does this document need something from the current user? */
function needsAction(status: string, perms: { review: boolean; approve: boolean }) {
  return (perms.review && ['uploaded', 'under_review', 'verified'].includes(status)) || (perms.approve && status === 'pending_approval')
}

async function Payments({ ctx, profile }: { ctx: Ctx; profile: StudentProfile }) {
  const s = profile.student
  const [ledger, lookups] = await Promise.all([studentLedger(ctx, s.id), getLookups(ctx)])
  const recordOrgs = orgOptions(ctx, profile, 'payments.record')
  const back = `/students/${s.id}`
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ledger.balances.length === 0 && <Card><p className="text-sm text-slate-600">No ledger entries yet.</p></Card>}
        {ledger.balances.map((b) => (
          <Card key={b.org_id + b.ledger + b.currency} title={`${b.ledger === 'service' ? 'Service fees' : 'Third-party money (e.g. university fees)'} · ${b.org_name}`}>
            <DL items={b.ledger === 'service' ? [
              ['Amount due', fmtMoney(b.amount_due, b.currency)], ['Received (verified)', fmtMoney(b.amount_received, b.currency)],
              ['Outstanding', <strong key="o" className={Number(b.outstanding) > 0 ? 'text-red-700' : ''}>{fmtMoney(b.outstanding, b.currency)}</strong>],
              ['Awaiting verification', fmtMoney(b.pending_receipts, b.currency)],
            ] : [
              ['Collected from student (verified)', fmtMoney(b.amount_received, b.currency)], ['Paid out (verified)', fmtMoney(b.amount_disbursed, b.currency)],
              ['Held, not yet paid out', fmtMoney(b.held_balance, b.currency)], ['Due from student', fmtMoney(b.outstanding, b.currency)],
            ]} />
          </Card>
        ))}
      </div>
      <Card title="Ledger entries" padded={false}>
        {ledger.entries.length === 0 ? <EmptyState title="No entries" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Entry</th><th className="text-right">Amount</th><th>Reference</th><th>Recorded by</th><th>Verification</th><th></th></tr></thead>
            <tbody>{ledger.entries.map((e) => (
              <tr key={e.id} className={e.verification_status === 'rejected' ? 'opacity-60' : ''}>
                <td className="whitespace-nowrap">{fmtDate(e.entry_date)}</td>
                <td><span className="font-medium">{label(e.entry_type)}</span> · {e.fee_category}<div className="text-xs text-slate-500">{e.org_name}{e.ledger === 'third_party' ? ' · third-party' : ''}{e.payee ? ` · paid to ${e.payee}` : ''}{e.notes ? ` · ${e.notes}` : ''}</div></td>
                <td className="text-right tabular-nums">{fmtMoney(e.amount, e.currency)}</td>
                <td className="text-xs">{e.method && label(e.method)}{e.reference_no && <div>{e.reference_no}</div>}{e.receipt_ref && <div>Receipt {e.receipt_ref}</div>}</td>
                <td className="text-xs">{e.recorder_name}<div className="text-slate-500">{fmtDateTime(e.recorded_at)}</div></td>
                <td><StatusBadge status={e.verification_status} />{e.verifier_name && <div className="text-xs text-slate-500">{e.verifier_name}</div>}{e.reversed_by_id && <div className="text-xs text-amber-700">Reversed</div>}</td>
                <td className="text-right">
                  {e.verification_status === 'pending' && can(ctx, 'payments.verify', e.org_id) && e.recorded_by !== ctx.userId && <VerifyForm entryId={e.id} back={back} />}
                  {e.verification_status === 'pending' && e.recorded_by === ctx.userId && <span className="text-xs text-slate-500">Needs another verifier</span>}
                  {['verified', 'not_required'].includes(e.verification_status) && e.entry_type !== 'reversal' && !e.reversed_by_id && can(ctx, 'payments.reverse', e.org_id) && <ReverseForm entryId={e.id} back={back} />}
                </td>
              </tr>))}
            </tbody>
          </table></div>
        )}
        <p className="hint px-4 pb-3">Entries cannot be edited or deleted. Mistakes are corrected with a reversal, which also needs verification.</p>
      </Card>
      {recordOrgs.length > 0 && s.status !== 'merged' && (
        <Card title="Record an entry">
          <PaymentForm studentId={s.id} orgs={recordOrgs} categories={ledger.categories} today={todayISO()}
            entities={lookups.legalEntities.map((e) => ({ value: e.id, label: e.name }))} />
        </Card>
      )}
    </div>
  )
}

async function Notes({ ctx, profile }: { ctx: Ctx; profile: StudentProfile }) {
  const s = profile.student
  const { notes, followups } = await getNotes(ctx, s.id)
  const writeOrgs = orgOptions(ctx, profile, 'notes.write')
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Card title="Follow-ups" padded={false}>
          {followups.length === 0 ? <EmptyState title="No follow-ups logged" /> : (
            <ul className="divide-y divide-slate-100">{followups.map((f) => (
              <li key={f.id} className="p-4 text-sm">
                <p className="text-xs text-slate-500">{fmtDateTime(f.occurred_at)} · {label(f.channel)} · {f.author}</p>
                <p className="mt-1 whitespace-pre-wrap">{f.summary}</p>
                {f.next_followup_date && <p className="mt-1 text-xs text-slate-600">Next follow-up: {fmtDate(f.next_followup_date)}</p>}
              </li>))}
            </ul>
          )}
        </Card>
        {profile.permissions.notesWrite && writeOrgs.length > 0 && s.status !== 'merged' && <Card title="Log a follow-up"><FollowupForm studentId={s.id} orgs={writeOrgs} /></Card>}
      </div>
      <div className="space-y-6">
        <Card title="Internal notes" padded={false}>
          {notes.length === 0 ? <EmptyState title="No notes" /> : (
            <ul className="divide-y divide-slate-100">{notes.map((n) => (
              <li key={n.id} className="p-4 text-sm">
                <p className="text-xs text-slate-500">{fmtDateTime(n.created_at)} · {n.author} · {n.org_name} {n.visibility === 'restricted' && <Badge tone="amber">Restricted</Badge>}</p>
                <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
              </li>))}
            </ul>
          )}
        </Card>
        {profile.permissions.notesWrite && writeOrgs.length > 0 && s.status !== 'merged' && (
          <Card title="Add a note"><NoteForm studentId={s.id} orgs={writeOrgs} canRestricted={profile.permissions.notesRestricted} /></Card>
        )}
      </div>
    </div>
  )
}

async function Messages({ ctx, profile }: { ctx: Ctx; profile: StudentProfile }) {
  const s = profile.student
  const [consents, msgs] = await Promise.all([getConsents(ctx, s.id), listMessages(ctx, profile.accessOrgIds, { studentId: s.id })])
  const cell = (who: string, ch: string) => {
    const v = consents.current[`${who}.${ch}`]
    return v === undefined ? <span className="text-slate-400">not asked</span> : v ? <Badge tone="green">Yes</Badge> : <Badge tone="red">No</Badge>
  }
  return (
    <div className="space-y-6">
      <Card title="Consent to receive messages">
        <table className="text-sm"><thead><tr><th></th><th className="px-4">Email</th><th className="px-4">WhatsApp</th><th className="px-4">SMS</th></tr></thead>
          <tbody>{['student', 'parent'].map((who) => (
            <tr key={who}><td className="py-1 pr-4 font-medium capitalize">{who}</td>{['email', 'whatsapp', 'sms'].map((ch) => <td key={ch} className="px-4">{cell(who, ch)}</td>)}</tr>))}
          </tbody></table>
        {consents.canRecord && <div className="mt-4 border-t border-slate-100 pt-4"><ConsentForm studentId={s.id} /></div>}
        {consents.history.length > 0 && (
          <details className="mt-3 text-sm"><summary className="cursor-pointer text-slate-600">Consent history</summary>
            <ul className="mt-2 space-y-1">{consents.history.map((h) => (
              <li key={h.id} className="text-xs">{fmtDateTime(h.recorded_at)} · {h.recipient} · {h.channel} · <strong>{h.granted ? 'agreed' : 'withdrawn'}</strong> · {h.source} · {h.by ?? 'system'}</li>))}
            </ul>
          </details>
        )}
      </Card>
      <Card title="Messages about this student" padded={false}>
        {msgs.rows.length === 0 ? <EmptyState title="No messages" /> : <MessageTable rows={msgs.rows} back={`/students/${s.id}`} showStudent={false} />}
      </Card>
    </div>
  )
}

const CATEGORY_TONE = { student: 'blue', stage: 'purple', document: 'amber', task: 'slate', note: 'slate', followup: 'slate', payment: 'green', assignment: 'blue' } as const

async function Timeline({ ctx, id }: { ctx: Ctx; id: string }) {
  const events = await getTimeline(ctx, id)
  return (
    <Card title="Activity timeline" padded={false}>
      {events.length === 0 ? <EmptyState title="No activity yet" /> : (
        <ol className="divide-y divide-slate-100">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 p-4 text-sm">
              <div className="w-36 shrink-0 text-xs text-slate-500">{fmtDateTime(e.occurred_at)}</div>
              <div>
                <Badge tone={CATEGORY_TONE[e.category as keyof typeof CATEGORY_TONE] ?? 'slate'}>{label(e.category)}</Badge>{' '}
                <span>{e.summary}</span>
                {e.actor && <div className="text-xs text-slate-500">by {e.actor}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="hint px-4 pb-3">Only events you are permitted to see are shown (e.g. payment events require finance access).</p>
    </Card>
  )
}
