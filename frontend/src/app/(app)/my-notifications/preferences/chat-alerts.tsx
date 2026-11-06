'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { chatMuteAction, saveChatAlertsAction } from '@/app/actions/chat'
import { type DesktopStatus, desktopStatus, desktopWanted, turnOffDesktop, turnOnDesktop } from '@/components/desktop-notifications'
import { ActionForm, SubmitButton } from '@/components/forms'
import { Card } from '@/components/ui'

export function ChatAlerts({ userId, settings, muted }: { userId: string; settings: { inApp: boolean; sound: boolean; desktopPreview: boolean }; muted: { id: string; title: string }[] }) {
  const [status, setStatus] = useState<DesktopStatus | null>(null)
  const [on, setOn] = useState(false)
  const [mutedNow, setMutedNow] = useState(muted)
  useEffect(() => {
    const t = setTimeout(() => { setStatus(desktopStatus()); setOn(desktopWanted(userId)) }, 0)
    return () => clearTimeout(t)
  }, [userId])
  const turnOn = async () => { const s = await turnOnDesktop(userId); setStatus(s); setOn(s === 'granted') }
  return (
    <Card title="Chat alerts">
      <ActionForm action={saveChatAlertsAction} className="space-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="inApp" defaultChecked={settings.inApp} />Show alerts inside the ERP when a new message arrives</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="sound" defaultChecked={settings.sound} />Play a sound</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="desktopPreview" defaultChecked={settings.desktopPreview} />Show message text in desktop notifications (it may appear on a locked screen)</label>
        <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
      </ActionForm>
      <div className="mt-4 border-t border-slate-100 pt-3 text-sm" data-testid="desktop-alerts">
        <p className="font-medium">Desktop notifications on this device</p>
        <p className="text-xs text-slate-500">They need the browser to be running with the ERP open. New messages are checked every few seconds, and less often in a background tab.</p>
        {status === 'unsupported' && <p className="mt-2">This browser cannot show them. On iPhone and iPad they need the ERP added to the Home Screen and aren&apos;t available in an ordinary Safari tab. Alerts inside the ERP still work.</p>}
        {status === 'denied' && <p className="mt-2">Notifications are blocked for this site. To use them, allow them in your browser&apos;s site settings. Alerts inside the ERP still work.</p>}
        {(status === 'default' || (status === 'granted' && !on)) && <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => void turnOn()}>Turn on desktop notifications</button>}
        {status === 'granted' && on && <p className="mt-2">On for this browser. <button type="button" className="btn-ghost btn-sm" onClick={() => { turnOffDesktop(userId); setOn(false) }}>Turn off</button></p>}
      </div>
      <div className="mt-4 border-t border-slate-100 pt-3 text-sm">
        <p className="font-medium">Muted conversations</p>
        {mutedNow.length === 0 ? <p className="text-xs text-slate-500">None. To mute one, open it in Chat and choose Mute alerts.</p> : (
          <ul className="mt-1 divide-y divide-slate-100" data-testid="muted-conversations">{mutedNow.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-1.5"><Link href={`/chat?c=${c.id}`}>{c.title}</Link>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { void chatMuteAction(c.id, false).then((r) => { if (r.ok) setMutedNow((m) => m.filter((x) => x.id !== c.id)) }) }}>Unmute</button></li>))}</ul>
        )}
      </div>
    </Card>
  )
}
