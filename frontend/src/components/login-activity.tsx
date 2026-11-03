import { fmtDateTime, label } from './format'
import { Badge, Card } from './ui'
import type { ActiveSession, LoginEvent } from '@/services/security'

const EVENT: Record<string, string> = {
  login: 'Password accepted', login_failed: 'Failed sign-in', mfa_verified: 'Two-factor code accepted', mfa_failed: 'Wrong two-factor code',
  mfa_recovery_code_used: 'Recovery code used', mfa_enabled: 'Two-factor login set up', mfa_reset_by_admin: 'Two-factor login reset by administrator',
  logout: 'Signed out', password_changed: 'Password changed', password_reset_completed: 'Password set via link', sessions_revoked: 'Signed out everywhere',
  staff_invitation_accepted: 'Invitation accepted', staff_status_changed: 'Account status changed',
}

export function LoginActivity({ data }: { data: { history: LoginEvent[]; sessions: ActiveSession[] } }) {
  return (
    <Card title="Sign-in activity">
      <p className="label">Active sessions ({data.sessions.length})</p>
      {data.sessions.length === 0 ? <p className="mb-3 text-sm text-slate-600">None.</p> : (
        <ul className="mb-4 space-y-1 text-sm">{data.sessions.map((s, i) => (
          <li key={i}>{fmtDateTime(s.created_at)} · last active {fmtDateTime(s.last_seen_at)} · {s.ip ?? 'unknown address'}
            <span className="block truncate text-xs text-slate-500">{s.user_agent}</span>
            {s.two_factor_pending && <Badge tone="amber">Waiting for two-factor code</Badge>}</li>))}</ul>
      )}
      <p className="label">Login history (latest {data.history.length})</p>
      {data.history.length === 0 ? <p className="text-sm text-slate-600">No sign-in events yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Event</th><th>Result</th><th>Address</th></tr></thead>
          <tbody>{data.history.map((h, i) => (
            <tr key={i}><td className="whitespace-nowrap text-xs">{fmtDateTime(h.occurred_at)}</td><td className="text-sm">{EVENT[h.event] ?? label(h.event)}</td>
              <td>{h.outcome === 'success' ? <Badge tone="green">OK</Badge> : <Badge tone="red">{label(h.outcome)}</Badge>}</td><td className="font-mono text-xs">{h.ip ?? '—'}</td></tr>))}</tbody>
        </table></div>
      )}
    </Card>
  )
}
