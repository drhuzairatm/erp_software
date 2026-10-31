import type { Metadata } from 'next'
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { fmtDateTime } from '@/components/format'
import { requireUser } from '@/server/auth/session'
import { MISMATCH_LABELS, RECORD_KINDS, SUBJECT_KEYS, academicConfig, canApproveTemplates, canManageAcademicRules } from '@/server/services/academic'
import { getLookups } from '@/server/services/lookups'
import { AcademicCheckSelect, AddOasRuleForm, AddTemplateForm, AddThresholdForm, TemplateButtons, Toggle } from './forms'

export const metadata: Metadata = { title: 'Academic & name rules' }

export default async function AcademicRulesPage() {
  const ctx = await requireUser()
  const manage = canManageAcademicRules(ctx); const approve = canApproveTemplates(ctx)
  if (!manage && !approve) return <PageHeader title="Academic & name rules" description="You do not have access to this page." />
  const [c, l] = await Promise.all([academicConfig(ctx), getLookups(ctx)])
  const countries = l.countries.filter((x) => x.is_destination).map((x) => ({ id: x.id, name: x.name }))
  const universities = l.universities.map((x) => ({ id: x.id, name: x.name })); const courses = l.courses.map((x) => ({ id: x.id, name: x.name }))
  const intakes = l.intakes.map((x) => ({ id: x.id, name: `${x.name} (${l.universities.find((u) => u.id === x.university_id)?.name ?? ''})` }))
  return (
    <>
      <PageHeader title="Academic & name rules" description="Eligibility thresholds, academic checks per stage, name-mismatch (One and Same) rules and templates." />
      <div className="mb-4"><Alert tone="blue">These are your business rules, not legal advice. Thresholds and name checks only flag cases for staff; nothing is rejected automatically.</Alert></div>
      <div className="space-y-6">
        <Card title="Eligibility thresholds" padded={false}>
          {c.thresholds.length === 0 ? <EmptyState title="No thresholds" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Subject</th><th className="text-right">Min %</th><th>Applies to</th><th></th></tr></thead>
              <tbody>{c.thresholds.map((t) => (
                <tr key={t.id} className={t.is_active ? '' : 'opacity-50'}>
                  <td>{t.name}{t.source_note && <div className="text-xs text-slate-500">{t.source_note}</div>}</td>
                  <td>{t.subject_key === 'overall' ? 'Overall' : SUBJECT_KEYS[t.subject_key as keyof typeof SUBJECT_KEYS]} <span className="text-xs text-slate-500">({RECORD_KINDS[t.record_kind as keyof typeof RECORD_KINDS]})</span></td>
                  <td className="text-right tabular-nums">{Number(t.min_percentage)}</td>
                  <td className="text-xs">{[t.destination, t.university, t.course, t.intake, t.grading_system].filter(Boolean).join(' · ') || 'All students'}</td>
                  <td>{manage && <Toggle kind="threshold" id={t.id} active={t.is_active} />}</td>
                </tr>))}
              </tbody>
            </table></div>
          )}
          {manage && <div className="border-t border-slate-100 p-4"><AddThresholdForm countries={countries} universities={universities} courses={courses} intakes={intakes} /></div>}
        </Card>
        <Card title="Academic check by stage">
          <p className="mb-3 text-sm text-slate-600">When a student moves forward to (or past) a stage: check that Plus Two (or MBBS for postgraduate medical courses) is recorded and thresholds are met.
            Draft profiles are never blocked earlier.</p>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">{c.stages.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-2 text-sm">{s.name}
              {manage ? <AcademicCheckSelect stageKey={s.key} value={s.academic_check} /> : <Badge>{s.academic_check}</Badge>}</li>))}
          </ul>
        </Card>
        <Card title="One and Same rules" padded={false}>
          {c.rules.length === 0 ? <EmptyState title="No rules – name differences are warnings only; staff can still require a One and Same document" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Requirement</th><th>When</th><th></th></tr></thead>
              <tbody>{c.rules.map((r) => (
                <tr key={r.id} className={r.is_active ? '' : 'opacity-50'}>
                  <td>{r.name}</td><td>{r.requirement === 'mandatory' ? <Badge tone="red">Mandatory</Badge> : <Badge tone="blue">Recommended</Badge>}</td>
                  <td className="text-xs">{[r.mismatch_type && MISMATCH_LABELS[r.mismatch_type], r.record_kind && RECORD_KINDS[r.record_kind as keyof typeof RECORD_KINDS], r.destination, r.university, r.course].filter(Boolean).join(' · ') || 'Any name difference'}</td>
                  <td>{manage && <Toggle kind="rule" id={r.id} active={r.is_active} />}</td>
                </tr>))}
              </tbody>
            </table></div>
          )}
          {manage && <div className="border-t border-slate-100 p-4"><AddOasRuleForm countries={countries} universities={universities} courses={courses} /></div>}
        </Card>
        <Card title="One and Same templates">
          {c.templates.length === 0 ? <p className="text-sm text-slate-500">No templates yet.</p> : (
            <ul className="space-y-3">{c.templates.map((t) => (
              <li key={t.id} className={`rounded-md border p-3 ${t.status === 'retired' ? 'opacity-50' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{t.name} <Badge tone={t.status === 'approved' ? 'green' : t.status === 'draft' ? 'amber' : 'slate'}>{t.status}</Badge>
                    {t.approved_at && <span className="text-xs font-normal text-slate-500"> · {t.approved_by_name} {fmtDateTime(t.approved_at)}</span>}</p>
                  <TemplateButtons id={t.id} status={t.status} canApprove={approve} />
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{t.body}</pre>
              </li>))}
            </ul>
          )}
          {manage && <div className="mt-4"><AddTemplateForm /></div>}
        </Card>
      </div>
    </>
  )
}
