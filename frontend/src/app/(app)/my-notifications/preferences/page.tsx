import type { Metadata } from 'next'
import { Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { myNotificationPreferences } from '@/services/staff-notifications'
import { PreferenceRow } from './row'

export const metadata: Metadata = { title: 'Notification preferences' }

export default async function PreferencesPage() {
  const ctx = await requireUser()
  const prefs = await myNotificationPreferences(ctx)
  return (
    <>
      <PageHeader back={{ href: '/my-notifications', label: 'My notifications' }} title="Notification preferences" description="Critical notifications and management announcements always arrive." />
      <Card><ul className="divide-y divide-slate-100">{prefs.map((p) => <PreferenceRow key={p.key} category={p.key} label={p.label} help={p.help} inApp={p.in_app} email={p.email} />)}</ul></Card>
    </>
  )
}
