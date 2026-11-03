import { fmtDateTime } from '@/components/format'
import { DISPLAY, type Level, LevelIcon, NoticeCard } from '@/components/notice'
import type { StudentAdvisory } from '@/services/requirements'
import { ACADEMIC_STATUS, CATEGORIES } from '@/services/requirements'
import { AcknowledgeButton } from './acknowledge-button'

const RESULT: Record<string, { label: string; level: Level }> = {
  ok: { label: 'Meets', level: 'success' }, below: { label: 'Below requirement', level: 'warning' },
  missing: { label: 'Not recorded', level: 'warning' }, not_comparable: { label: 'Manual review', level: 'info' },
}

/** A country-wise requirement notice for a student (advisory: never blocks). */
export function AdvisoryNotice({ a, studentId, canAck, compactOverride }: { a: StudentAdvisory; studentId: string; canAck: boolean; compactOverride?: boolean }) {
  const d = DISPLAY[a.display_type] ?? DISPLAY.general_information
  const compact = compactOverride ?? (a.priority === 'normal' || a.priority === 'informational')
  const st = a.academic_status ? ACADEMIC_STATUS[a.academic_status] : null
  const scope = [a.university, a.course].filter(Boolean).join(' · ')
  return (
    <NoticeCard level={d.level} label={d.label} compact={compact} title={a.title}
      actions={a.requires_acknowledgement && !a.acknowledged_at && canAck ? <AcknowledgeButton studentId={studentId} noticeId={a.notice_id} /> : undefined}
      footer={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{CATEGORIES[a.category]}{scope && ` · ${scope}`} · version {a.version} · advisory, does not block the application</span>
          {a.requires_acknowledgement && (a.acknowledged_at
            ? <span className="inline-flex items-center gap-1 font-medium text-green-800"><LevelIcon level="success" className="h-3.5 w-3.5" />Requirements acknowledged by {a.acknowledged_by}, {fmtDateTime(a.acknowledged_at)}</span>
            : <span className="inline-flex items-center gap-1 font-medium"><LevelIcon level="warning" className="h-3.5 w-3.5" />Acknowledgement pending{a.earlier_acknowledgement && ' (an earlier version was acknowledged; the requirement has changed)'}</span>)}
        </span>}
      details={a.notes || a.description ? <p className="whitespace-pre-wrap">{[a.description, a.notes].filter(Boolean).join('\n\n')}</p> : undefined}>
      <p>{a.message}</p>
      {a.items.length > 0 && (
        <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {a.items.map((i) => (
            <li key={i.subject + i.record_kind} className="flex items-center justify-between gap-2 rounded bg-white/70 px-2 py-1 ring-1 ring-black/5">
              <span><strong>{i.subject}</strong>: minimum {i.min_percentage != null ? `${Number(i.min_percentage)}%` : `${Number(i.min_marks)} marks`}
                {i.actual != null && <span className="text-xs opacity-75"> · recorded {Number(i.actual)}{i.min_percentage != null ? '%' : ''}</span>}</span>
              <span className="inline-flex items-center gap-1 text-xs font-medium"><LevelIcon level={RESULT[i.result].level} className="h-3.5 w-3.5" />{RESULT[i.result].label}</span>
            </li>
          ))}
        </ul>
      )}
      {st && <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold"><LevelIcon level={st.level} className="h-4 w-4" />{st.label}</p>}
    </NoticeCard>
  )
}
