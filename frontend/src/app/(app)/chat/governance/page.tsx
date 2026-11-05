import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDateTime, label } from '@/components/format'
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { CAPABILITIES, governanceAccess, governanceData } from '@/services/chat-governance'
import { DelegateForm, HoldForm, ReleaseHold, RequestForm, RetentionForm, RevokeDelegate } from './forms'

export const metadata: Metadata = { title: 'Chat governance' }

export default async function ChatGovernancePage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const access = await governanceAccess(ctx)
  if (!access.length) return <PageHeader title="Chat governance" description="You do not have access to this page." />
  const me = access.find((a) => a.org_id === sp.org) ?? access[0]
  const d = await governanceData(ctx, me.org_id)
  const capLabel = (k: string) => CAPABILITIES.find(([c]) => c === k)?.[1] ?? k
  const readers = d.people.filter((p) => d.delegates.some((x) => x.user_id === p.id && x.capability === 'reader'))
  return (
    <>
      <PageHeader title="Chat governance" description="Retention, legal holds and restricted investigation access. Nobody can read private messages from this page without an approved request." back={{ href: '/chat', label: 'Chat' }} />
      {access.length > 1 && <div className="mb-4 flex flex-wrap gap-2">{access.map((a) => <Link key={a.org_id} className={a.org_id === me.org_id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} href={`/chat/governance?org=${a.org_id}`}>{a.org_name}</Link>)}</div>}
      <div className="space-y-6">
        <Card title="Retention policy">
          {!d.policy?.purge_enabled
            ? <Alert tone="blue">No retention policy is being applied. Nothing is removed automatically until the MD approves one and turns it on.</Alert>
            : <Alert tone="amber">Applied automatically: messages stay visible for {d.policy.retention_days} days, then move to the archive. {d.policy.archive_retention_days ? `The archive is erased after ${d.policy.archive_retention_days} days.` : 'The archive is kept.'} Messages under a legal hold are skipped.</Alert>}
          {d.policy?.approver && <p className="hint mt-2">Last set by {d.policy.approver}, {fmtDateTime(d.policy.approved_at)}. Reference: {d.policy.approval_reference ?? 'none'}</p>}
          {me.is_md && <div className="mt-4"><RetentionForm orgId={me.org_id} v={d.policy} /></div>}
          {d.runs.length > 0 && <ul className="mt-4 divide-y divide-slate-100 text-sm">{d.runs.map((r) => <li key={r.id} className="py-1.5">{fmtDateTime(r.ran_at)}: {r.archived} archived, {r.purged} erased, {r.held_skipped} skipped because of a hold</li>)}</ul>}
        </Card>

        <Card title="Named authorities">
          {d.delegates.length === 0 ? <EmptyState title="Nobody has been named" /> : <ul className="divide-y divide-slate-100 text-sm" data-testid="delegates">{d.delegates.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-medium">{x.full_name}</span>: {capLabel(x.capability)}<span className="block text-xs text-slate-500">{x.reason} · {fmtDateTime(x.granted_at)}</span></span>
              {me.is_md && <RevokeDelegate orgId={me.org_id} user={x.user_id} capability={x.capability} />}</li>))}</ul>}
          {me.is_md && <div className="mt-4 border-t border-slate-100 pt-4"><DelegateForm orgId={me.org_id} people={d.people} capabilities={CAPABILITIES.map(([value, l]) => ({ value, label: l }))} /></div>}
        </Card>

        <Card title="Legal holds">
          <p className="hint mb-3">While a hold is active, the messages and archive it covers are never removed by the retention policy.</p>
          {d.holds.length === 0 ? <EmptyState title="No legal holds" /> : <ul className="divide-y divide-slate-100 text-sm" data-testid="holds">{d.holds.map((h) => (
            <li key={h.id} className="py-2"><span className="flex flex-wrap items-center gap-2"><span className="font-medium">{h.reference}</span>{h.released_at ? <Badge tone="slate">Released</Badge> : <Badge tone="amber">Active</Badge>}</span>
              <span className="block text-xs text-slate-500">{h.subject ?? h.group_name ?? 'Whole company'} · placed by {h.placed_by}, {fmtDateTime(h.placed_at)}{h.released_at ? ` · released ${fmtDateTime(h.released_at)}: ${h.release_reason}` : ''}</span>
              <span className="block whitespace-pre-wrap wrap-anywhere">{h.reason}</span>
              {!h.released_at && me.approver && <ReleaseHold id={h.id} />}</li>))}</ul>}
          {me.approver && <div className="mt-4 border-t border-slate-100 pt-4"><HoldForm orgId={me.org_id} people={d.people} groups={d.groups} /></div>}
        </Card>

        <Card title="Investigation requests">
          {d.requests.length === 0 ? <EmptyState title="No requests" /> : <ul className="divide-y divide-slate-100 text-sm" data-testid="requests">{d.requests.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0"><Link className="font-medium" href={`/chat/governance/${q.id}`}>{q.reference}</Link>
              <span className="block text-xs text-slate-500">Requested by {q.requester}, {fmtDateTime(q.requested_at)} · reader {q.reader} · {q.reads} read{q.reads === 1 ? '' : 's'}</span></span><Badge tone={q.status === 'approved' ? 'green' : q.status === 'pending' ? 'amber' : 'slate'}>{label(q.status)}</Badge></li>))}</ul>}
          {me.requester && <details className="mt-4 border-t border-slate-100 pt-4"><summary className="cursor-pointer font-medium">New request</summary><div className="mt-3">{readers.length === 0 ? <Alert tone="amber">The MD must name a reader first.</Alert> : <RequestForm orgId={me.org_id} people={d.people} readers={readers} groups={d.groups} />}</div></details>}
        </Card>
      </div>
    </>
  )
}
