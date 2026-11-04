import type { Metadata } from 'next'
import { Alert, Badge, Card, PageHeader } from '@/components/ui'
import { can } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { getLookups } from '@/services/lookups'
import { channelStatus, EVENTS, getNotificationSettings } from '@/services/notifications'
import { RuleToggle, TemplateForm } from '../../notifications/message-forms'

export const metadata: Metadata = { title: 'Notification settings' }

export default async function NotificationSettingsPage() {
  const ctx = await requireUser()
  const orgs = ctx.memberships.filter((m) => can(ctx, 'notifications.manage', m.orgId))
  if (!orgs.length) return <PageHeader title="Notification settings" description="You do not have permission to configure notifications." />
  const [settings, lookups] = await Promise.all([getNotificationSettings(ctx), getLookups(ctx)])
  const status = channelStatus(orgs.map((o) => o.orgCode))
  const stages = lookups.stages.map((s) => ({ key: s.key, name: s.name }))
  return (
    <>
      <PageHeader title="Notification settings" description="Which events send messages, on which channel, with which wording. Messages go only to students/parents who have given consent." />
      <div className="mb-6 space-y-3">
        <Alert tone={status.mode === 'test' ? 'amber' : 'green'} title={status.mode === 'test' ? 'Test mode is on' : 'Live mode'}>
          {status.mode === 'test' ? 'Nothing is sent to students or parents (except test recipients). Switch to live mode in the server settings (NOTIFICATIONS_MODE=live) once the wording and providers are confirmed.' : 'Messages are being delivered.'}
        </Alert>
        {/* configuration status (finding N-8): production refuses to start unless NOTIFICATIONS_MODE=live */}
        <Alert tone={status.config.errors.length ? 'red' : status.config.warnings.length ? 'amber' : 'green'} title={`Configuration: ${status.config.environment}`}>
          <span className="block">NOTIFICATIONS_MODE is {status.config.explicit ? `set to "${status.mode}"` : 'not set to a valid value (test mode)'}.
            {' '}Production requires NOTIFICATIONS_MODE=live; staging and development may use test mode.</span>
          {[...status.config.errors, ...status.config.warnings].map((w) => <span key={w} className="block">{w}</span>)}
          <span className="block">Sign-in codes and email-verification links are never shown here or in Messages; in test mode they are not sent and not stored.</span>
        </Alert>
        <Card title="Channels">
          <div className="relative overflow-x-auto"><table className="text-sm"><thead><tr><th>Company</th><th>Email (SMTP)</th><th>WhatsApp (Gallabox)</th><th>SMS</th></tr></thead>
            <tbody>{status.channels.map((c) => (
              <tr key={c.code}><td className="py-1 pr-4">{orgs.find((o) => o.orgCode === c.code)?.orgName}</td>
                <td className="pr-4">{c.email ? <Badge tone="green">Configured</Badge> : <Badge>Not configured</Badge>}</td>
                <td className="pr-4">{c.whatsapp ? <Badge tone="green">Configured (format to be confirmed)</Badge> : <Badge>Not configured</Badge>}</td>
                <td><Badge>No provider (DLT needed)</Badge></td></tr>))}
            </tbody></table></div>
          <p className="hint mt-2">Provider credentials are set by the technical administrator in the server environment, never in the database. See docs/NOTIFICATIONS.md.</p>
        </Card>
      </div>
      {orgs.map((o) => (
        <Card key={o.orgId} title={`${o.orgName}: when to send`} className="mb-6" padded={false}>
          <div className="table-wrap"><table>
            <thead><tr><th>Event</th><th>Email to student</th><th>WhatsApp to student</th><th>Email to parent</th><th>WhatsApp to parent</th></tr></thead>
            <tbody>{EVENTS.map((e) => (
              <tr key={e.key}><td className="font-medium">{e.label}</td>
                {([['email', 'student'], ['whatsapp', 'student'], ['email', 'parent'], ['whatsapp', 'parent']] as const).map(([ch, aud]) => {
                  const rule = settings.rules.find((r) => r.org_id === o.orgId && r.event_key === e.key && r.channel === ch && r.audience === aud)
                  const tpl = rule ? settings.templates.find((t) => t.id === rule.template_id)
                    : settings.templates.find((t) => t.org_id === o.orgId && t.channel === ch && settings.rules.some((r) => r.template_id === t.id && r.event_key === e.key))
                  if (!tpl) return <td key={ch + aud} className="text-xs text-slate-400">no template</td>
                  return <td key={ch + aud}><RuleToggle orgId={o.orgId} eventKey={e.key} channel={ch} audience={aud} templateId={tpl.id} enabled={!!rule?.is_enabled}
                    stageKeys={rule?.stage_keys ?? []} stages={e.key === 'stage_changed' ? stages : undefined} /></td>
                })}
              </tr>))}
            </tbody>
          </table></div>
        </Card>
      ))}
      {orgs.map((o) => (
        <Card key={`t-${o.orgId}`} title={`${o.orgName}: message templates`} className="mb-6">
          <div className="space-y-6">{settings.templates.filter((t) => t.org_id === o.orgId).map((t) => (
            <div key={t.id} className="rounded-md border border-slate-200 p-3">
              <p className="mb-2 text-sm font-medium">{t.name} · {t.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}
                {t.channel === 'whatsapp' && !t.provider_template_name && <> <Badge tone="amber">Needs approved template name</Badge></>}</p>
              <TemplateForm t={t} placeholders={status.placeholders} />
            </div>))}
          </div>
        </Card>
      ))}
    </>
  )
}
