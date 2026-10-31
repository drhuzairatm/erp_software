import Link from 'next/link'
import { fmtDate, fmtDateTime } from '@/components/format'
import { Alert, Badge, Card, DL, EmptyState } from '@/components/ui'
import { GRADING_SYSTEMS, MISMATCH_LABELS, OAS_STATUS, RECORD_KINDS, SUBJECT_KEYS, getAcademic } from '@/server/services/academic'
import type { Ctx } from '@/server/services/base'
import { getLookups } from '@/server/services/lookups'
import { EditRecord, NameCheckReview, OasActions, RecordForm } from './academic-forms'

const RESULT: Record<string, { label: string; tone: 'green' | 'red' | 'amber' | 'slate' }> = {
  ok: { label: 'Meets', tone: 'green' }, below: { label: 'Below threshold', tone: 'red' }, missing: { label: 'Not recorded', tone: 'amber' }, not_comparable: { label: 'Check manually', tone: 'amber' },
}

export async function AcademicTab({ ctx, studentId, canEdit }: { ctx: Ctx; studentId: string; canEdit: boolean }) {
  const [a, lookups] = await Promise.all([getAcademic(ctx, studentId), getLookups(ctx)])
  if (!a) return null
  const countries = lookups.countries.map((c) => ({ id: c.id, name: c.name }))
  // PG medical applicants: MBBS-based fields first; Plus Two fields are not offered by default
  const kinds = a.profile === 'pg_medical' ? ['mbbs', 'internship', 'medical_registration', 'plus_two', 'class_10', 'other'] : ['plus_two', 'class_10', 'bachelor', 'other']
  const edit = canEdit && a.perms.edit
  const below = a.eligibility.filter((e) => e.result === 'below')
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        {a.profile === 'pg_medical' && <Alert tone="blue">Postgraduate medical applicant ({a.course}): record the MBBS degree, internship and medical registration. Plus Two details are optional.</Alert>}
        {a.records.length === 0 && <Card><EmptyState title="No academic records yet" /></Card>}
        {a.records.map((r) => {
          const subs = a.subjects.filter((x) => x.record_id === r.id)
          const result = r.grading_system === 'cgpa_10' || r.grading_system === 'cgpa_4' ? r.cgpa && `${r.cgpa} ${r.grading_system === 'cgpa_4' ? '/ 4' : '/ 10'}`
            : r.grading_system === 'letter_grade' || r.grading_system === 'other' ? r.grade : r.pct && `${r.pct}%${r.marks_obtained ? ` (${r.marks_obtained} / ${r.total_marks})` : ''}`
          return (
            <Card key={r.id} title={r.kind === 'other' && r.title ? r.title : RECORD_KINDS[r.kind]}>
              <DL items={[
                ['Name on certificate', r.name_on_certificate], ['Certificate / register no.', [r.certificate_number, r.register_number].filter(Boolean).join(' · ') || null],
                ['Board / university', r.board], ['Institution', r.institution_name ? `${r.institution_name}${r.institution_country ? ` (${r.institution_country})` : ''}` : null],
                ['Issuing country', r.issuing_country], ['Year of passing', r.year_of_passing], ['Stream', r.stream],
                ['Grading system', r.grading_system && GRADING_SYSTEMS[r.grading_system as keyof typeof GRADING_SYSTEMS]], ['Result', result],
                ['Issue date', fmtDate(r.issue_date)],
                ...(r.kind === 'internship' ? [['Internship', `${fmtDate(r.start_date) ?? '?'} – ${fmtDate(r.end_date) ?? '?'}`] as [string, string]] : []),
                ...(r.kind === 'medical_registration' ? [['Registration', [r.registration_authority, r.registration_number, r.registration_valid_until && `valid until ${fmtDate(r.registration_valid_until)}`].filter(Boolean).join(' · ')] as [string, string]] : []),
              ]} />
              {subs.length > 0 && (
                <div className="table-wrap mt-3"><table>
                  <thead><tr><th>Subject</th><th className="text-right">Marks</th><th className="text-right">%</th><th>Grade</th></tr></thead>
                  <tbody>{subs.map((x) => (
                    <tr key={x.id}><td>{x.subject_name}{x.subject_key !== 'other' && <span className="text-xs text-slate-500"> · {SUBJECT_KEYS[x.subject_key as keyof typeof SUBJECT_KEYS]}</span>}</td>
                      <td className="text-right tabular-nums">{x.marks_obtained != null ? `${x.marks_obtained} / ${x.max_marks ?? '?'}` : '—'}</td>
                      <td className="text-right tabular-nums">{x.pct ?? '—'}</td><td>{x.grade}</td></tr>))}
                  </tbody>
                </table></div>
              )}
              {r.notes && <p className="mt-2 text-sm text-slate-700">{r.notes}</p>}
              <p className="mt-2 text-xs text-slate-500">Updated {fmtDateTime(r.updated_at)}{r.updated_by_name && ` by ${r.updated_by_name}`}</p>
              {edit && <EditRecord studentId={studentId} countries={countries} kinds={[...new Set([r.kind, ...kinds])]}
                initial={{ ...r, subjects: subs.map((x) => ({ subject_key: x.subject_key, subject_name: x.subject_name, max_marks: x.max_marks, marks_obtained: x.marks_obtained, percentage: x.percentage, grade: x.grade })) }} />}
            </Card>
          )
        })}
        {edit && <Card title="Add academic record"><RecordForm studentId={studentId} countries={countries} kinds={kinds} /></Card>}
      </div>
      <div className="space-y-6">
        <Card title={<span className="flex items-center gap-2">Eligibility {below.length > 0 && <Badge tone="red">{below.length} below</Badge>}</span>}>
          {a.eligibility.length === 0 ? <p className="text-sm text-slate-500">No thresholds apply to this student&apos;s destination, university, course and intake.</p> : (
            <ul className="space-y-2 text-sm">{a.eligibility.map((e) => (
              <li key={e.threshold_id} className="flex items-start justify-between gap-2">
                <span>{e.subject_key === 'overall' ? 'Overall' : SUBJECT_KEYS[e.subject_key as keyof typeof SUBJECT_KEYS]} ≥ {Number(e.min_percentage)}%
                  <span className="block text-xs text-slate-500">{e.name}{e.actual && ` · recorded ${e.actual}%`}</span></span>
                <Badge tone={RESULT[e.result].tone}>{RESULT[e.result].label}</Badge>
              </li>))}
            </ul>
          )}
          <p className="hint mt-2">Flags for staff; they never reject an application automatically.</p>
        </Card>
        <Card title="Name checks">
          {!a.holderName ? <p className="text-sm text-slate-600">Record the passport holder name (Passport tab) to compare it with the certificates.</p>
            : <p className="mb-2 text-xs text-slate-500">Passport name: <strong>{a.holderName}</strong></p>}
          {a.holderName && a.checks.length === 0 && <p className="text-sm text-green-800">No differences found between the passport and the certificates recorded.</p>}
          <ul className="space-y-4">{a.checks.map((c) => {
            const st = c.case_status ? OAS_STATUS[c.case_status] : c.requirement ? OAS_STATUS[c.requirement] : null
            return (
              <li key={c.id} className="rounded-md border border-amber-200 bg-amber-50/40 p-3 text-sm">
                <p><strong>{RECORD_KINDS[c.record_kind as keyof typeof RECORD_KINDS]}</strong>: “{c.certificate_name}”</p>
                <p className="text-xs text-amber-900">{c.mismatch_types.map((t) => MISMATCH_LABELS[t] ?? t).join(' · ')} — needs human review</p>
                <p className="mt-1 text-xs">One and Same: {st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge>Not required</Badge>}
                  {c.review_status === 'no_action' && <span className="text-slate-600"> · reviewed by {c.reviewer}: {c.review_note}</span>}</p>
                {c.preview_text && <pre className="mt-2 whitespace-pre-wrap rounded bg-white p-2 text-xs ring-1 ring-slate-200">{c.preview_text}</pre>}
                {c.requested_at && <p className="mt-1 text-xs text-slate-600">Requested {fmtDateTime(c.requested_at)} ({c.request_channel === 'manual' ? `manual: ${c.request_note}` : 'message'})</p>}
                {c.cancel_reason && <p className="mt-1 text-xs text-slate-600">Cancelled: {c.cancel_reason}</p>}
                {c.student_document_id && <p className="mt-1 text-xs"><Link href={`/students/${studentId}/documents/${c.student_document_id}`}>Open the One and Same checklist item →</Link></p>}
                {a.perms.review && !c.case_id && c.review_status === 'open' && <NameCheckReview studentId={studentId} checkId={c.id} mandatory={c.requirement === 'mandatory'} />}
                {a.perms.review && c.case_id && !c.cancel_reason && !['approved', 'cancelled'].includes(c.case_status ?? '') && (
                  <OasActions studentId={studentId} caseId={c.case_id} templates={a.templates} templateId={c.template_id} hasPreview={!!c.preview_text}
                    requested={!!c.requested_at} canCancel={a.perms.approve} />)}
              </li>
            )
          })}</ul>
          <p className="hint mt-2">Differences are warnings for review; they never make a document invalid on their own.</p>
        </Card>
      </div>
    </div>
  )
}
