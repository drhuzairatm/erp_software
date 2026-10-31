import type { Metadata } from 'next'
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { run } from '@/server/services/base'
import { getLookups } from '@/server/services/lookups'
import { canManagePassportRules, contactRequiredStage, listValidityRules } from '@/server/services/passport'
import { AddRuleForm, ContactStageForm, ToggleRule } from './forms'

export const metadata: Metadata = { title: 'Passport & contact rules' }

export default async function PassportRulesPage() {
  const ctx = await requireUser()
  if (!canManagePassportRules(ctx)) return <PageHeader title="Passport & contact rules" description="You do not have access to this page." />
  const [rules, lookups, current, stages] = await Promise.all([listValidityRules(ctx), getLookups(ctx), contactRequiredStage(ctx),
    run(ctx, (tx) => tx<{ key: string; name: string }[]>`select key, name from stages where kind = 'normal' order by sort_order`)])
  return (
    <>
      <PageHeader title="Passport & contact rules" description="Minimum passport validity by destination, university, course and stage; when full contact details become mandatory." />
      <div className="mb-4"><Alert tone="blue">Passport expiry never blocks admissions on its own. A rule only applies where you configure it.
        Expiry statuses are fixed: more than 12 months = Valid, 12 months or less = Expiry warning, 6 months or less = Urgent renewal, 3 months or less = Critical, past expiry = Expired.</Alert></div>
      <div className="space-y-6">
        <Card title="Contact details"><ContactStageForm stages={stages} current={current?.key ?? null} />
          <p className="hint mt-2">Draft profiles may stay incomplete. Moving a student forward to this stage (or later) is refused until the details are entered.</p></Card>
        <Card title="Minimum passport validity" padded={false}>
          {rules.length === 0 ? <EmptyState title="No rules configured" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Rule</th><th>Applies to</th><th>From stage</th><th className="text-right">Months</th><th>When not met</th><th></th></tr></thead>
              <tbody>{rules.map((r) => (
                <tr key={r.id} className={r.is_active ? '' : 'opacity-50'}>
                  <td className="font-medium">{r.name}{r.notes && <div className="text-xs font-normal text-slate-500">{r.notes}</div>}</td>
                  <td className="text-xs">{[r.destination, r.university, r.course].filter(Boolean).join(' · ') || 'All students'}</td>
                  <td>{r.stage}</td><td className="text-right tabular-nums">{r.min_months}</td>
                  <td>{r.enforcement === 'block' ? <Badge tone="red">Block</Badge> : <Badge tone="amber">Warn</Badge>}</td>
                  <td><ToggleRule id={r.id} active={r.is_active} /></td>
                </tr>))}
              </tbody>
            </table></div>
          )}
          <div className="border-t border-slate-100 p-4">
            <AddRuleForm stages={stages} countries={lookups.countries.filter((c) => c.is_destination).map((c) => ({ id: c.id, name: c.name }))}
              universities={lookups.universities.map((u) => ({ id: u.id, name: u.name }))} courses={lookups.courses.map((c) => ({ id: c.id, name: c.name }))} />
          </div>
        </Card>
      </div>
    </>
  )
}
