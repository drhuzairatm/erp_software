import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDateTime, label } from '@/components/format'
import { Badge, Card, EmptyState, PageHeader, StatCard } from '@/components/ui'
import { Icon } from '@/components/icons'
import { requireUser } from '@/lib/auth/session'
import { scannerName } from '@/lib/security/scanner'
import { canSeeSecurity, listAlerts } from '@/services/security'
import { AckForm } from './ack-form'

export const metadata: Metadata = { title: 'Security alerts' }
const TONE = { critical: 'red', high: 'red', warning: 'amber', info: 'slate' } as const

export default async function SecurityAlertsPage({ searchParams }: { searchParams: Promise<{ all?: string; severity?: string }> }) {
  const sp = await searchParams
  const ctx = await requireUser()
  if (!canSeeSecurity(ctx)) return <PageHeader title="Security alerts" description="You do not have permission to view security alerts." />
  const alerts = await listAlerts(ctx, { open: !sp.all, severity: sp.severity })
  const open = alerts.filter((a) => !a.acknowledged_at)
  const scanner = scannerName()
  return (
    <>
      <PageHeader title="Security alerts" description="Raised automatically from the tamper-proof audit log: repeated failed sign-ins, permission and role changes, large or frequent exports, bulk downloads, malware, manual security clearances, MD role grants and two-factor resets. Repeats within an hour are grouped." />
      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Summary">
        <StatCard label="Open alerts" value={open.length} tone={open.length ? 'amber' : 'slate'} icon={<Icon name="shield" className="h-5 w-5" />} />
        <StatCard label="High / critical" value={open.filter((a) => a.severity === 'high' || a.severity === 'critical').length} tone="red" icon={<Icon name="close" className="h-5 w-5" />} />
        <div className="card col-span-2 p-4 text-sm">
          <p className="font-medium">Virus scanner</p>
          {scanner ? <p className="text-green-800">{scanner} configured – uploads are scanned; earlier files are re-scanned daily.</p>
            : <p className="text-amber-900">Not configured. Uploaded files stay “Not virus-scanned” and need MANUAL security clearance before approval or courier release. Manual clearance is not a virus scan.</p>}
        </div>
      </section>
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div><label className="label" htmlFor="sev">Severity</label>
          <select className="input" id="sev" name="severity" defaultValue={sp.severity ?? ''}><option value="">All</option>{['critical', 'high', 'warning', 'info'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="all" value="1" defaultChecked={!!sp.all} /> Include acknowledged</label>
        <button className="btn-primary" type="submit">Apply</button><Link className="btn-ghost" href="/admin/security">Clear</Link>
      </form>
      {alerts.length === 0 ? <EmptyState title="No alerts">Nothing needs attention.</EmptyState> : (
        <Card padded={false}><ul className="divide-y divide-slate-100">{alerts.map((a) => (
          <li key={a.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TONE[a.severity]}>{label(a.severity)}</Badge>
              <span className="font-medium">{a.title}</span>
              {a.occurrences > 1 && <Badge>{a.occurrences}×</Badge>}
              {a.acknowledged_at && <Badge tone="green">Acknowledged</Badge>}
            </div>
            <p className="mt-1 text-xs text-slate-500">First {fmtDateTime(a.created_at)} · last {fmtDateTime(a.last_seen_at)}{a.actor_name ? ` · by ${a.actor_name}` : ''}{a.org_name ? ` · ${a.org_name}` : ''}</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-600">{Object.entries(a.details ?? {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}</p>
            {a.acknowledged_at ? <p className="mt-1 text-xs text-slate-600">Acknowledged by {a.acknowledged_by_name} {fmtDateTime(a.acknowledged_at)}{a.ack_note ? `: ${a.ack_note}` : ''}</p>
              : <div className="mt-2"><AckForm id={a.id} /></div>}
          </li>))}</ul></Card>
      )}
    </>
  )
}
