import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDate, fmtDateTime } from '@/components/format'
import { NoticeCard } from '@/components/notice'
import { Alert, Avatar, Badge, Card, DL, PageHeader } from '@/components/ui'
import { orgsWith } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { getLead, LEAD_STATUSES, PROGRAMMES, SOURCES } from '@/server/services/leads'
import { ConvertButton, DuplicateButtons, EditLeadForm, LeadWorkForm, RouteForm } from '../lead-forms'
import { leadFormOptions } from '../options'

export const metadata: Metadata = { title: 'Lead' }

const KIND: Record<string, string> = { created: 'Created', note: 'Note', call: 'Call', status: 'Status', assignment: 'Assignment', routing: 'Routing',
  followup: 'Follow-up', duplicate: 'Duplicate review', conversion: 'Conversion' }

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params
  const { created } = await searchParams
  const ctx = await requireUser()
  const data = await getLead(ctx, id)
  if (!data) notFound()
  const { lead: l } = data
  const st = LEAD_STATUSES[l.status]
  const o = await leadFormOptions(ctx)
  const routeOrgs = ctx.memberships.filter((m) => orgsWith(ctx, 'leads.manage').includes(m.orgId)).map((m) => ({ value: m.orgId, label: m.orgName }))
  return (
    <>
      <PageHeader back={{ href: '/leads', label: 'Leads' }}
        title={<span className="flex flex-wrap items-center gap-3"><Avatar name={l.full_name} />{l.full_name} <Badge tone={st.tone}>{st.label}</Badge></span>}
        description={<span className="flex flex-wrap gap-x-3">{l.org_name ?? 'Central review queue'} · {SOURCES[l.source as keyof typeof SOURCES]}
          {l.referrer_code_student && <span>· referred by student <Link href={`/students/${l.referrer_student_id}`}>{l.referrer_code_student}</Link></span>}
          <span>· created {fmtDateTime(l.created_at)}{l.creator && ` by ${l.creator}`}</span></span>}
        actions={data.canConvert && !l.converted_student_id && !['invalid', 'closed'].includes(l.status) && <ConvertButton id={l.id} />} />
      {created && <div className="mb-4"><Alert tone="green">Lead added.</Alert></div>}
      <div className="mb-4 space-y-2">
        {l.duplicate_status === 'possible' && (
          <NoticeCard level="warning" label="Duplicate" title="Possible duplicate – review before contacting" actions={data.manage && <DuplicateButtons id={l.id} />}>
            {l.duplicate_note} Leads are never merged automatically.</NoticeCard>)}
        {!l.org_id && (
          <NoticeCard level="info" label="Routing" title="Central review queue: the company is not certain yet">
            Route the lead to Dr.Expert Edulinks (MBBS, Nursing, Medical PG) or GRADUATER (Bachelor&apos;s, General PG).
            {data.review && <div className="mt-2"><RouteForm id={l.id} orgs={routeOrgs} current={l.org_id} /></div>}</NoticeCard>)}
        {l.converted_student_id && (
          <NoticeCard level="success" title={`Registered as student ${l.student_code ?? ''}`}
            actions={<Link href={`/students/${l.converted_student_id}`} className="text-sm font-medium">Open the student →</Link>}>
            The status becomes &quot;Admission confirmed&quot; automatically when the student reaches the Admission Letter stage.</NoticeCard>)}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {data.manage && <Card title="Follow-up"><LeadWorkForm id={l.id} status={l.status} assignedTo={l.assigned_to} followup={l.next_followup_on}
            staff={data.staff.map((s) => ({ value: s.id, label: s.full_name }))} /></Card>}
          <Card title="Details">
            {data.manage ? <EditLeadForm id={l.id} o={o} v={l} /> : (
              <DL items={[['Phone', l.phone], ['WhatsApp', l.whatsapp], ['Email', l.email], ['Programme', l.programme && PROGRAMMES[l.programme as keyof typeof PROGRAMMES]],
                ['Course', l.course], ['Destination', l.destination], ['Residence', l.residence], ['Qualification', l.qualification],
                ['Preferred company', l.preferred_company], ['Remarks', l.remarks]]} />)}
            <p className="hint mt-3">Consent to be contacted: {l.consent ? `yes${l.consent_at ? `, recorded ${fmtDateTime(l.consent_at)}` : ''}` : 'not recorded'}.
              {l.closed_reason && ` Closed: ${l.closed_reason}.`} {data.manage && l.org_id && !data.review && 'Only the central review team can move a lead to another company.'}</p>
          </Card>
          {data.review && l.org_id && <Card title="Routing"><RouteForm id={l.id} orgs={routeOrgs} current={l.org_id} /></Card>}
        </div>
        <Card title="Activity">
          <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5 text-sm">
            {data.activities.map((a) => (
              <li key={a.id} className="relative">
                <span aria-hidden className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500 ring-2 ring-brand-100" />
                <p className="text-xs text-slate-500">{fmtDateTime(a.created_at)} · {a.actor ?? 'System'} · {KIND[a.kind] ?? a.kind}</p>
                <p className="whitespace-pre-wrap">{a.body}</p>
              </li>))}
          </ol>
          {l.next_followup_on && <p className="hint mt-4">Next follow-up {fmtDate(l.next_followup_on)}</p>}
        </Card>
      </div>
    </>
  )
}
