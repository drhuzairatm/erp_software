import { fmtDate, fmtDateTime, label } from '@/components/format'
import { Badge, Card, DL, EmptyState } from '@/components/ui'
import { PASSPORT_TIERS, type PassportTier, getPassportData } from '@/server/services/passport'
import type { Ctx } from '@/server/services/base'
import { getLookups } from '@/server/services/lookups'
import { NoticeCard } from '@/components/notice'
import { PassportFollowupForm, RecordPassportForm, VerifyPassportForm } from './passport-forms'

export function PassportStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null
  const t = PASSPORT_TIERS[status as PassportTier]
  return t ? <Badge tone={t.tone}>Passport: {t.label}</Badge> : null
}

const KIND: Record<string, string> = { initial: 'First recorded', renewal: 'Renewal', correction: 'Correction', edit: 'Edited on the student form' }
const FU: Record<string, string> = { contact: 'Contacted', commitment: 'Renewal commitment', remark: 'Remark', received: 'Renewed passport received' }

export async function PassportTab({ ctx, studentId, canEdit }: { ctx: Ctx; studentId: string; canEdit: boolean }) {
  const [data, lookups] = await Promise.all([getPassportData(ctx, studentId), getLookups(ctx)])
  if (!data) return <p className="text-sm text-slate-600">Passport details are hidden for your role.</p>
  const c = data.current
  const pend = data.pending
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        {pend && (
          <Card title={<span className="flex items-center gap-2">New passport awaiting verification <Badge tone="amber">Not active yet</Badge></span>}>
            <div className="mb-4"><NoticeCard level="warning" title="Not yet active">
              Version {pend.version} was recorded by {pend.created_by_name ?? 'staff'} on {fmtDateTime(pend.created_at)}. Until it is verified, the {c ? 'current passport' : 'student record'} stays
              unchanged and the passport rules and expiry alerts use the active passport.</NoticeCard></div>
            <DL items={[
              ['Passport number', <span key="n" className="font-mono">{pend.passport_number}</span>],
              ['Holder name (as printed)', pend.holder_name ?? <span className="text-slate-500">Not recorded</span>],
              ['Issuing country', pend.issuing_country], ['Issue date', fmtDate(pend.issue_date)], ['Expiry date', fmtDate(pend.expiry_date)],
              ['Recorded as', KIND[pend.kind]], ['Notes', pend.notes],
            ]} />
            {data.canVerify && canEdit
              ? <div className="mt-4 border-t border-slate-100 pt-4"><VerifyPassportForm studentId={studentId} passportId={pend.id} /></div>
              : <p className="hint mt-3">A manager or documentation staff member verifies new passports.</p>}
          </Card>
        )}
        <Card title={<span className="flex items-center gap-2">Current passport {c && <span className="text-sm font-normal text-slate-500">version {c.version}</span>} <PassportStatusBadge status={c?.tier} /></span>}>
          {!c ? <EmptyState title="No passport recorded" /> : (
            <DL items={[
              ['Passport number', c.passport_number && <span className="font-mono">{c.passport_number}</span>],
              ['Holder name (as printed)', c.holder_name ?? <span className="text-slate-500">Not recorded</span>],
              ['Date of birth', fmtDate(c.date_of_birth)], ['Gender', c.gender && label(c.gender)],
              ['Nationality', c.nationality], ['Citizenship', c.citizenship], ['Issuing country', c.issuing_country],
              ['Place of issue', c.place_of_issue], ['Issue date', fmtDate(c.issue_date)], ['Expiry date', fmtDate(c.expiry_date)],
              ['Scan', c.document_file_id ? 'Linked to the Passport document at the time of recording' : <span className="text-slate-500">No scan linked (upload on the Documents tab)</span>],
            ]} />
          )}
        </Card>
        {canEdit && <Card title={c ? 'Record a renewal or correction' : 'Record passport details'}>
          {pend && <p className="hint mb-3">A new passport is awaiting verification. Verify or reject it before recording another new passport (corrections to the current passport are still possible).</p>}
          <RecordPassportForm studentId={studentId} countries={lookups.countries.map((x) => ({ id: x.id, name: x.name }))}
            current={c && { holder_name: c.holder_name, date_of_birth: c.date_of_birth, gender: c.gender, nationality_country_id: c.nationality_country_id,
              citizenship_country_id: c.citizenship_country_id, issuing_country_id: c.issuing_country_id }} />
        </Card>}
        <Card title="Passport history" padded={false}>
          <div className="table-wrap"><table>
            <thead><tr><th>Version</th><th>Number</th><th>Expiry</th><th>Recorded</th><th>Notes</th></tr></thead>
            <tbody>{data.versions.map((v) => (
              <tr key={v.id} className={v.is_current ? '' : 'text-slate-500'}>
                <td>v{v.version} · {KIND[v.kind]}{v.is_current && <> <Badge tone="green">current</Badge></>}
                  {v.verification_status === 'pending' && <> <Badge tone="amber">awaiting verification</Badge></>}
                  {v.verification_status === 'rejected' && <> <Badge tone="red">rejected</Badge></>}</td>
                <td className="font-mono">{v.passport_number}</td><td>{fmtDate(v.expiry_date)}</td>
                <td>{fmtDateTime(v.created_at)}<div className="text-xs">{v.created_by_name ?? 'Imported'}</div></td>
                <td className="text-xs">{v.notes}
                  {v.verified_at && <div>{v.verification_status === 'rejected' ? 'Rejected' : 'Verified'} by {v.verified_by_name ?? '—'} · {fmtDateTime(v.verified_at)}{v.verification_note && ` – ${v.verification_note}`}</div>}
                  {v.superseded_at && <div>Superseded {fmtDateTime(v.superseded_at)}</div>}</td>
              </tr>))}
            </tbody>
          </table></div>
        </Card>
      </div>
      <div className="space-y-6">
        <Card title="Renewal follow-up">
          {canEdit && <div className="mb-4"><PassportFollowupForm studentId={studentId} /></div>}
          {data.followups.length === 0 ? <p className="text-sm text-slate-500">No entries yet.</p> : (
            <ul className="space-y-2 text-sm">{data.followups.map((f) => (
              <li key={f.id} className="border-b border-slate-100 pb-2">
                <p><strong>{FU[f.kind]}</strong>{f.expected_date && <> · expected {fmtDate(f.expected_date)}</>}</p>
                <p className="text-slate-700">{f.note}</p>
                <p className="text-xs text-slate-500">{f.author ?? 'System'} · {fmtDateTime(f.created_at)}</p>
              </li>))}
            </ul>
          )}
        </Card>
        <Card title="Passport tasks">
          {data.tasks.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
            <ul className="space-y-1 text-sm">{data.tasks.map((t) => (
              <li key={t.id}>{t.title} <span className="text-xs text-slate-500">· {label(t.status)}{t.assignee && ` · ${t.assignee}`}{t.due_date && ` · due ${fmtDate(t.due_date)}`}</span></li>))}
            </ul>
          )}
          <p className="hint mt-2">Created automatically at 12, 6 and 3 months before expiry and on expiry (managers are included from 6 months).</p>
        </Card>
      </div>
    </div>
  )
}
