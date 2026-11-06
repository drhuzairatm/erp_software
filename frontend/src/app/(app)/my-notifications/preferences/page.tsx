import type { Metadata } from 'next'
import { Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { myChatAlertSettings, myMutedConversations } from '@/services/chat-notifications'
import { myNotificationPreferences } from '@/services/staff-notifications'
import { ChatAlerts } from './chat-alerts'
import { PreferenceRow } from './row'

export const metadata: Metadata = { title: 'Notification preferences' }

export default async function PreferencesPage() {
  const ctx = await requireUser()
  const [prefs, chatAlerts, muted] = await Promise.all([myNotificationPreferences(ctx), myChatAlertSettings(ctx), myMutedConversations(ctx)])
  return (
    <>
      <PageHeader back={{ href: '/my-notifications', label: 'My notifications' }} title="Notification preferences" description="Critical notifications and management announcements always arrive." />
      <Card><ul className="divide-y divide-slate-100">{prefs.map((p) => <PreferenceRow key={p.key} category={p.key} label={p.label} help={p.help} inApp={p.in_app} email={p.email} />)}</ul></Card>
      <div className="mt-4"><ChatAlerts userId={ctx.userId} settings={chatAlerts} muted={muted} /></div>
    </>
  )
}
