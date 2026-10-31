import type { Metadata } from 'next'
import { Badge, Card, PageHeader } from '@/components/ui'
import { can, canAny } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { getSettings } from '@/server/services/admin'
import { getLookups } from '@/server/services/lookups'
import { AddReferenceForm, OrgSettingsForm, ToggleReference, WorkflowForm } from '../admin-forms'

export const metadata: Metadata = { title: 'Company settings' }

export default async function SettingsPage() {
  const ctx = await requireUser()
  if (!canAny(ctx, ['settings.manage', 'reference.manage', 'workflow.manage', 'departments.manage'])) return <PageHeader title="Company settings" description="You do not have permission to change settings." />
  const [s, lookups] = await Promise.all([getSettings(ctx), getLookups(ctx)])
  const settingsOrgs = s.organizations.filter((o) => can(ctx, 'settings.manage', o.id))
  const refOrgs = s.organizations.filter((o) => can(ctx, 'reference.manage', o.id)).map((o) => ({ value: o.id, label: o.name }))
  const canRef = can(ctx, 'reference.manage')
  const canWf = can(ctx, 'workflow.manage')
  const orgName = (id: string) => s.organizations.find((o) => o.id === id)?.name ?? ''
  const Row = ({ kind, id, name, extra, active, editable }: { kind: Parameters<typeof ToggleReference>[0]['kind']; id: string; name: string; extra?: string | null; active: boolean; editable: boolean }) => (
    <li className={`flex items-center justify-between gap-2 py-1.5 text-sm ${active ? '' : 'text-slate-400'}`}>
      <span>{name}{extra && <span className="text-xs text-slate-500"> · {extra}</span>}{!active && ' (inactive)'}</span>
      {editable && <ToggleReference kind={kind} id={id} active={active} />}
    </li>
  )
  return (
    <>
      <PageHeader title="Company settings" description="Items are deactivated rather than deleted so that history stays intact." />
      <div className="space-y-6">
        {settingsOrgs.map((o) => (
          <Card key={o.id} title={<>{o.name} <span className="font-mono text-xs text-slate-500">Student ID prefix {o.student_code_prefix}</span></>}>
            <OrgSettingsForm orgId={o.id} name={o.name} currency={String(o.settings.currency ?? 'INR')} allowSelf={o.settings.allow_self_payment_verification === true}
              supportPhone={o.settings.support_phone as string | undefined} supportEmail={o.settings.support_email as string | undefined} />
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-2 text-sm font-medium">Fee categories</p>
              <ul className="divide-y divide-slate-100">{s.feeCategories.filter((f) => f.org_id === o.id).map((f) => (
                <Row key={f.id} kind="fee_category" id={f.id} name={f.name} extra={f.kind === 'service' ? 'service revenue' : 'third-party money'} active={f.is_active} editable />))}</ul>
              <div className="mt-2"><AddReferenceForm kind="fee_category" fields={[{ name: 'orgId', label: 'Company', options: [{ value: o.id, label: o.name }] }, { name: 'name', label: 'Name', required: true },
                { name: 'kind', label: 'Type', options: [{ value: 'service', label: 'Service revenue' }, { value: 'third_party', label: 'Third-party money' }] }]} /></div>
            </div>
          </Card>
        ))}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Departments (per company)">
            <ul className="divide-y divide-slate-100">{s.departments.map((d) => <Row key={d.id} kind="department" id={d.id} name={d.name} extra={orgName(d.org_id)} active={d.is_active} editable={can(ctx, 'departments.manage', d.org_id)} />)}</ul>
            {s.organizations.some((o) => can(ctx, 'departments.manage', o.id)) && (
              <div className="mt-2"><AddReferenceForm kind="department" fields={[{ name: 'orgId', label: 'Company', options: s.organizations.filter((o) => can(ctx, 'departments.manage', o.id)).map((o) => ({ value: o.id, label: o.name })) }, { name: 'name', label: 'Name', required: true }]} /></div>
            )}
          </Card>
          <Card title="Lead sources (per company)">
            <ul className="divide-y divide-slate-100">{s.leadSources.map((l) => <Row key={l.id} kind="lead_source" id={l.id} name={l.name} extra={orgName(l.org_id)} active={l.is_active} editable={can(ctx, 'reference.manage', l.org_id)} />)}</ul>
            {refOrgs.length > 0 && <div className="mt-2"><AddReferenceForm kind="lead_source" fields={[{ name: 'orgId', label: 'Company', options: refOrgs }, { name: 'name', label: 'Name', required: true }]} /></div>}
          </Card>
          <Card title="Contracting / legal entities and payment recipients">
            <p className="mb-2 text-xs text-slate-500">Kept separate from companies until the legal and accounting structure is confirmed.</p>
            <ul className="divide-y divide-slate-100">{s.legalEntities.map((l) => <Row key={l.id} kind="legal_entity" id={l.id} name={l.name} extra={l.notes} active={l.is_active} editable={canRef} />)}</ul>
            {canRef && <div className="mt-2"><AddReferenceForm kind="legal_entity" fields={[{ name: 'name', label: 'Name', required: true }, { name: 'registrationRef', label: 'Registration ref.' }]} /></div>}
          </Card>
          <Card title="Destination countries">
            <ul className="divide-y divide-slate-100">{s.countries.map((c) => <Row key={c.id} kind="country" id={c.id} name={c.name} extra={c.code} active={c.is_active} editable={canRef} />)}</ul>
            {canRef && <div className="mt-2"><AddReferenceForm kind="country" fields={[{ name: 'code', label: 'Code (2 letters)', required: true }, { name: 'name', label: 'Name', required: true }]} /></div>}
          </Card>
          <Card title="Courses">
            <ul className="divide-y divide-slate-100">{s.courses.map((c) => <Row key={c.id} kind="course" id={c.id} name={c.name} active={c.is_active} editable={canRef} />)}</ul>
            {canRef && <div className="mt-2"><AddReferenceForm kind="course" fields={[{ name: 'name', label: 'Name', required: true }]} /></div>}
          </Card>
          <Card title="Universities" className="lg:col-span-2">
            <ul className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-2 md:divide-y-0">{s.universities.map((u) => <Row key={u.id} kind="university" id={u.id} name={u.name} extra={`${u.country}${u.city ? ', ' + u.city : ''}`} active={u.is_active} editable={canRef} />)}</ul>
            {canRef && <div className="mt-2"><AddReferenceForm kind="university" fields={[{ name: 'countryId', label: 'Country', options: lookups.countries.map((c) => ({ value: c.id, label: c.name })) }, { name: 'name', label: 'Name', required: true }, { name: 'city', label: 'City' }]} /></div>}
          </Card>
        </div>

        <Card title="Workflows (country / course variations)">
          <div className="space-y-4">
            {s.workflows.map((w) => (
              <details key={w.id} className="rounded-md border border-slate-200">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-medium">{w.name}</span>{w.is_default && <Badge tone="blue">Default</Badge>}
                  <span className="text-xs text-slate-500">{[w.country, w.course].filter(Boolean).join(' · ') || 'All countries and courses'} · {w.stages.length} stages · {w.documents.filter((d) => d.required).length} required documents</span>
                </summary>
                <div className="border-t border-slate-200 p-3">
                  {w.description && <p className="mb-3 text-sm text-slate-600">{w.description}</p>}
                  {canWf ? (
                    <WorkflowForm id={w.id} selected={w.stages} selectedDocs={w.documents.filter((d) => d.required).map((d) => d.id)}
                      stages={lookups.stages.filter((st) => st.kind === 'normal' || st.kind === 'completed').map((st) => ({ value: st.key, label: st.name }))}
                      docs={lookups.documentTypes.map((d) => ({ value: d.id, label: d.name }))} />
                  ) : <p className="text-sm">Stages: {w.stages.join(', ')}</p>}
                </div>
              </details>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}
