import Link from 'next/link'
import { fmtDateTime, label } from '@/components/format'
import { Badge, type Tone } from '@/components/ui'
import type { MessageRow } from '@/server/services/notifications'
import { RetryButton } from './message-forms'

export const STATUS_TONE: Record<string, Tone> = { queued: 'blue', sending: 'blue', sent: 'green', delivered: 'green', read: 'green', failed: 'red', skipped: 'slate', test: 'purple' }
export const STATUS_LABEL: Record<string, string> = { test: 'Test – not sent', skipped: 'Skipped', queued: 'Queued', sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed' }

export function MessageTable({ rows, back, showStudent = true }: { rows: MessageRow[]; back: string; showStudent?: boolean }) {
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>When</th>{showStudent && <th>Student</th>}<th>Event</th><th>Channel / to</th><th>Message</th><th>Status</th><th></th></tr></thead>
      <tbody>{rows.map((m) => (
        <tr key={m.id}>
          <td className="whitespace-nowrap text-xs">{fmtDateTime(m.created_at)}{m.sent_at && <div className="text-slate-500">sent {fmtDateTime(m.sent_at)}</div>}</td>
          {showStudent && <td>{m.student_code ? <Link href={`/students/${m.student_id}?tab=messages`}>{m.student_name}</Link> : '—'}<div className="font-mono text-xs text-slate-500">{m.student_code}</div></td>}
          <td className="text-xs">{label(m.event_key)}</td>
          <td className="text-xs">{m.channel === 'whatsapp' ? 'WhatsApp' : label(m.channel)} · {m.recipient_type}<div className="text-slate-500">{m.to_address ?? '—'}</div></td>
          <td className="max-w-md text-xs">{m.subject && <p className="font-medium">{m.subject}</p>}<p className="line-clamp-3 whitespace-pre-wrap text-slate-700">{m.body ?? <span className="text-slate-400">(prepared when processed)</span>}</p></td>
          <td><Badge tone={STATUS_TONE[m.status] ?? 'slate'}>{STATUS_LABEL[m.status] ?? m.status}</Badge>
            {(m.skip_reason || m.last_error) && <div className="mt-1 max-w-48 text-xs text-slate-500">{m.skip_reason ?? m.last_error}</div>}
            {m.attempts > 1 && <div className="text-xs text-slate-500">{m.attempts} attempts</div>}</td>
          <td>{['failed', 'skipped', 'test'].includes(m.status) && <RetryButton id={m.id} back={back} />}</td>
        </tr>))}
      </tbody>
    </table></div>
  )
}
