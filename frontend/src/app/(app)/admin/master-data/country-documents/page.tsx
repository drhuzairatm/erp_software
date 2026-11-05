import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { fmtDateTime } from '@/components/format'
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { getLookups } from '@/services/lookups'
import { canManageCountryRules, canVerifyCountryRules, listCountryRules } from '@/services/preferences'
import { ActiveToggle, RuleForm, VerifyForm } from './forms'

export const metadata: Metadata = { title: 'Country documents' }

export default async function CountryDocumentsPage() {
  const ctx = await requireUser()
  if (!canManageCountryRules(ctx)) notFound()
  const [rules, l] = await Promise.all([listCountryRules(ctx), getLookups(ctx)])
  const canVerify = canVerifyCountryRules(ctx)
  const options = { countries: l.countries.map((c) => ({ id: c.id, name: c.name })), universities: l.universities.map((u) => ({ id: u.id, name: u.name, country_id: u.country_id })), courses: l.courses.map((c) => ({ id: c.id, name: c.name })), documents: l.documentTypes.map((d) => ({ id: d.id, name: d.name })), stages: l.stages.map((s) => ({ key: s.key, name: s.name })) }
  return (<>
    <PageHeader title="Country documents" description="Documents shown for a destination, as guidance. They never stop registration." />
    <div className="mb-4"><Alert tone="amber">Only enter a rule that has a real source. A rule stays inactive until someone with authority marks it verified. {canVerify ? '' : 'You can draft rules; the MD verifies them.'}</Alert></div>
    <details className="card mb-4 p-4"><summary className="cursor-pointer font-semibold">New rule</summary><div className="mt-4"><RuleForm options={options} /></div></details>
    <Card>{rules.length === 0 ? <EmptyState title="No rules yet" /> : <ul className="divide-y divide-slate-100">{rules.map((r) => (
      <li key={r.id} className="space-y-2 py-3 text-sm" data-testid="country-rule" data-rule={r.id}>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 font-medium wrap-anywhere">{r.country} · {r.document}{r.university ? ` · ${r.university}` : ''}{r.course ? ` · ${r.course}` : ''}</span>
          <span className="flex flex-wrap items-center gap-2"><Badge tone={r.verification_status === 'verified' ? 'green' : 'amber'}>{r.verification_status === 'verified' ? 'Verified' : 'Unverified'}</Badge><Badge tone={r.is_active ? 'green' : 'slate'}>{r.is_active ? 'Active' : 'Inactive'}</Badge></span></div>
        <p className="text-xs text-slate-600 wrap-anywhere">{r.is_required ? 'Required' : 'Recommended'}{r.stage ? ` at ${r.stage}` : ''}{r.match_rule ? '. Issuing country must match the visa application country' : ''}{r.guidance ? `. ${r.guidance}` : '. No timing guidance entered'}</p>
        <p className="text-xs text-slate-500 wrap-anywhere">Source: {r.source_note ?? 'not stated'}{r.verification_note ? `. Verification: ${r.verification_note}` : ''}{r.verified_at ? ` (${r.verifier ?? 'from the brief'}, ${fmtDateTime(r.verified_at)})` : ''}</p>
        <div className="flex flex-wrap items-end gap-3">{r.verification_status === 'verified' && <ActiveToggle id={r.id} active={r.is_active} />}{canVerify && <div className="min-w-64 flex-1"><VerifyForm id={r.id} verified={r.verification_status === 'verified'} /></div>}</div>
        <details><summary className="cursor-pointer text-xs font-semibold">Edit</summary><div className="mt-3"><RuleForm options={options} v={r} /></div></details>
      </li>))}</ul>}</Card>
  </>)
}
