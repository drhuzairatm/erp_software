import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDate, fmtDateTime } from '@/components/format'
import { Alert, Badge, Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { canApproveRules, canManageRules, getRule } from '@/server/services/verification-rules'
import { ruleOptions } from '../options'
import { AddRequirementForm, ApproveRuleButton, DeleteDraftButton, NewVersionButton, RemoveRequirementButton, RuleForm } from '../rule-forms'

export const metadata: Metadata = { title: 'Verification rule' }

const KIND: Record<string, string> = { exact_phrase: 'Exact phrase', statement: 'Statement', keywords: 'Keywords', manual_check: 'Manual check' }

export default async function RulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireUser()
  const data = await getRule(ctx, id)
  if (!data) notFound()
  const { rule: r } = data
  const draft = r.status === 'draft'
  const manage = canManageRules(ctx)
  return (
    <>
      <PageHeader title={r.name} back={{ href: '/admin/verification-rules', label: 'Verification rules' }}
        description={<span className="flex flex-wrap items-center gap-2">Version {r.version} <Badge tone={draft ? 'amber' : r.status === 'approved' ? 'green' : 'slate'}>{r.status}</Badge>
          {r.status === 'approved' && <span>effective {fmtDate(r.effective_from)} · approved by {r.approved_by_name} {fmtDateTime(r.approved_at)}</span>}
          {r.status === 'retired' && <span>{fmtDate(r.effective_from)} – {fmtDate(r.effective_to)}</span>}</span>}
        actions={<>
          {draft && canApproveRules(ctx) && <ApproveRuleButton ruleId={r.id} />}
          {r.status === 'approved' && manage && <NewVersionButton ruleId={r.id} />}
          {draft && manage && <DeleteDraftButton ruleId={r.id} />}
        </>} />
      {draft && !canApproveRules(ctx) && <div className="mb-4"><Alert tone="amber">This draft has no effect until the MD approves it.</Alert></div>}
      {data.usage > 0 && <div className="mb-4"><Alert tone="blue">{data.usage} verification record(s) were made against this version; they stay linked to it.</Alert></div>}
      <div className="space-y-6">
        <Card title="Scope"><RuleForm id={r.id} readOnly={!draft || !manage} options={await ruleOptions(ctx)}
          initial={{ name: r.name, description: r.description, documentTypeId: r.document_type_id, previousEducationCountryId: r.previous_education_country_id,
            destinationCountryId: r.destination_country_id, universityId: r.university_id, courseId: r.course_id }} /></Card>
        <Card title="Checks staff must confirm" padded={false}>
          {data.requirements.length === 0 ? <p className="p-4 text-sm text-slate-500">No checks yet.</p> : (
            <ol className="divide-y divide-slate-100">{data.requirements.map((q, i) => (
              <li key={q.id} className="flex items-start justify-between gap-3 p-4 text-sm">
                <div><p className="text-xs text-slate-500">{i + 1}. {KIND[q.kind]} · {q.is_mandatory ? 'mandatory' : 'optional'}</p>
                  <p className="mt-0.5 font-medium whitespace-pre-wrap">{q.text}</p>
                  {q.keywords.length > 0 && <p className="text-xs">Keywords: {q.keywords.join(', ')}</p>}
                  {q.guidance && <p className="text-xs text-slate-600">{q.guidance}</p>}</div>
                {draft && manage && <RemoveRequirementButton ruleId={r.id} reqId={q.id} />}
              </li>))}
            </ol>
          )}
          {draft && manage && <div className="border-t border-slate-100 p-4"><AddRequirementForm ruleId={r.id} /></div>}
        </Card>
        <Card title="Versions">
          <ul className="space-y-1 text-sm">{data.versions.map((v) => (
            <li key={v.id}><Link href={`/admin/verification-rules/${v.id}`}>Version {v.version}</Link> · {v.status}
              {v.effective_from && ` · ${fmtDate(v.effective_from)}${v.effective_to ? ` – ${fmtDate(v.effective_to)}` : ' onwards'}`}{v.id === r.id && ' (this)'}</li>))}
          </ul>
        </Card>
      </div>
    </>
  )
}
