import Link from 'next/link'
import { DISPLAY, LevelChip, LevelIcon, type Level } from '@/components/notice'
import { pendingAcknowledgements } from '@/services/requirements'
import { type Ctx, run } from '@/services/base'

/** Priority attention panel (staff and managers): what needs action first. Counts are live and limited to visible students. */
export async function PriorityAttention({ ctx, orgIds }: { ctx: Ctx; orgIds: string[] }) {
  const [counts] = await run(ctx, (tx) => tx<{ expired: number; critical: number; approvals: number; overdue: number }[]>`
    select count(*) filter (where s.passport_status = 'expired')::int as expired, count(*) filter (where s.passport_status = 'critical')::int as critical,
           (select count(*)::int from student_documents d join v_students x on x.id = d.student_id
             where d.status = 'pending_approval' and (x.originating_org_id = any(${tx.array(orgIds)}::uuid[]) or x.processing_org_id = any(${tx.array(orgIds)}::uuid[]))
               and app.can_on_student(x.id, 'documents.approve')) as approvals,
           (select count(*)::int from tasks t where t.org_id = any(${tx.array(orgIds)}::uuid[]) and t.status not in ('completed', 'cancelled')
               and t.due_date < current_date and t.priority in ('high', 'urgent')) as overdue
      from v_students s
     where s.status in ('active', 'on_hold') and (s.originating_org_id = any(${tx.array(orgIds)}::uuid[]) or s.processing_org_id = any(${tx.array(orgIds)}::uuid[]))`)
  const pending = await pendingAcknowledgements(ctx, orgIds, 8)
  const rows: { level: Level; label: string; text: string; href: string; n: number }[] = [
    { level: 'critical' as Level, label: 'Critical', text: 'Expired passports', href: '/reports/passport-expiry', n: counts.expired },
    { level: 'critical' as Level, label: 'Urgent', text: 'Passports expiring within 3 months', href: '/reports/passport-expiry', n: counts.critical },
    { level: 'critical' as Level, label: 'Approval', text: 'Documents awaiting manager approval', href: '/reports/documents?status=awaiting', n: counts.approvals },
    { level: 'critical' as Level, label: 'Overdue', text: 'Overdue high-priority tasks', href: '/tasks?view=overdue', n: counts.overdue },
  ].filter((r) => r.n > 0)
  if (!rows.length && !pending.length) {
    return (
      <section aria-label="Priority attention" className="mb-6 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
        <LevelIcon level="success" /> <LevelChip level="success" label="All clear" /> No critical alerts or pending acknowledgements for your students.
      </section>
    )
  }
  return (
    <section aria-label="Priority attention" className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><LevelIcon level="critical" /> Priority attention</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ul className="space-y-2">{rows.map((r) => (
          <li key={r.text}><Link href={r.href} className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950 no-underline hover:bg-red-100">
            <LevelIcon level={r.level} className="h-4 w-4" /><LevelChip level={r.level} label={r.label} /><span className="flex-1">{r.text}</span><strong className="tabular-nums">{r.n}</strong></Link></li>))}
          {!rows.length && <li className="text-sm text-slate-500">No critical alerts.</li>}
        </ul>
        <div>
          <p className="mb-2 text-sm font-medium">Notices awaiting staff acknowledgement</p>
          {pending.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
            <ul className="space-y-1.5">{pending.map((p) => {
              const d = DISPLAY[p.display_type] ?? DISPLAY.general_information
              return (
                <li key={p.student_id + p.title}><Link href={`/students/${p.student_id}`} className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-950 no-underline hover:bg-amber-100">
                  <LevelChip level={d.level} label="Pending" /><span className="font-medium">{p.full_name}</span><span className="text-xs">{p.student_code}</span>
                  <span className="w-full text-xs sm:w-auto">{p.title}{p.counsellor && ` · ${p.counsellor}`}</span></Link></li>
              )
            })}</ul>
          )}
          <Link href="/reports/pending-acknowledgements" className="mt-2 inline-block text-xs">All pending acknowledgements →</Link>
        </div>
      </div>
    </section>
  )
}
