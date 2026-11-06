'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { alertTitle, badgeText, CHAT_READ_EVENT, CHAT_STATE_EVENT, type ChatState, conversationHref, desktopBody, nextDelay, type NotifyMemory, pickNew, toastBody, type UnreadConversation } from '@/components/chat-notify-logic'
import { desktopWanted, showDesktopNotification } from '@/components/desktop-notifications'
import { Icon } from '@/components/icons'
import { HeaderMenu } from './header-menu'

type Published = ChatState & { fresh: UnreadConversation[]; reconnecting: boolean }
type Channel = { type: 'state'; state: Published } | { type: 'poke' }
const TOAST_MS = 8000
const VISIBLE_TOASTS = 3

const readMemory = (key: string): NotifyMemory => {
  try { const m = JSON.parse(localStorage.getItem(key) ?? 'null'); if (m && Array.isArray(m.seen)) return m } catch { /* storage may be blocked */ }
  return { baseline: null, seen: [] }
}
const writeMemory = (key: string, m: NotifyMemory) => { try { localStorage.setItem(key, JSON.stringify(m)) } catch { /* a private window may refuse */ } }
const openConversation = () => (location.pathname === '/chat' ? new URLSearchParams(location.search).get('c') : null)

/**
 * The header's unread badge and alerts on every staff page. One poller per person per browser: tabs elect a leader with the Web
 * Locks API, and the leader shares each result. The tab being looked at takes over, because browsers slow down hidden tabs.
 * Reading a poll marks nothing as read; only an open, visible conversation does that (ChatRoom).
 */
export function ChatNotifier({ userId, showCompany }: { userId: string; showCompany: boolean }) {
  const [state, setState] = useState<Published | null>(null)
  const [toasts, setToasts] = useState<UnreadConversation[]>([])
  const stateRef = useRef<Published | null>(null)

  useEffect(() => {
    let stopped = false; let leader = false; let running = false; let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let generation = 0; let release: (() => void) | null = null; let queued: AbortController | null = null
    let audio: AudioContext | null = null
    const memoryKey = `erp.chat.notify.${userId}`; const focusKey = `erp.chat.focus.${userId}`
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`erp-chat-${userId}`)
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    const visible = () => document.visibilityState === 'visible'

    const apply = (next: Published) => {
      stateRef.current = next
      setState(next)
      window.dispatchEvent(new CustomEvent(CHAT_STATE_EVENT, { detail: next }))
      if (!next.settings.inApp) { setToasts([]); return }
      const current = openConversation()
      const showable = visible() ? next.fresh.filter((c) => c.id !== current) : []
      setToasts((old) => {
        const stillUnread = old.filter((t) => next.conversations.some((c) => c.id === t.id))
        return [...showable, ...stillUnread.filter((t) => !showable.some((n) => n.id === t.id))].slice(0, 8)
      })
    }
    const publish = (next: Published) => { apply(next); channel?.postMessage({ type: 'state', state: next } satisfies Channel) }

    const beep = () => {
      if (!audio) return
      try {
        const osc = audio.createOscillator(); const gain = audio.createGain()
        osc.frequency.value = 880; gain.gain.value = 0.05
        osc.connect(gain).connect(audio.destination); osc.start(); osc.stop(audio.currentTime + 0.15)
      } catch { /* sound is optional */ }
    }
    const someTabFocused = () => { try { return document.hasFocus() || !!localStorage.getItem(focusKey) } catch { return document.hasFocus() } }

    const schedule = () => {
      clearTimeout(timer)
      if (!stopped && leader) timer = setTimeout(() => { void tick() }, nextDelay(visible(), failures))
    }
    const tick = async () => {
      if (stopped || !leader || running) return
      running = true
      const abort = new AbortController(); const limit = setTimeout(() => abort.abort(), 10_000)
      try {
        const res = await fetch(`/api/chat/notifications${location.pathname === '/chat' ? '?chat=1' : ''}`, { cache: 'no-store', signal: abort.signal })
        if (!res.ok) throw new Error('unavailable')
        const d = await res.json() as ({ signedIn: false } | (ChatState & { signedIn: true; serverTime: string }))
        failures = 0
        if (!d.signedIn) {
          stopped = true // signed out or past the idle limit: stay quiet until the next page load
          publish({ total: 0, sig: '', settings: { inApp: false, sound: false, desktopPreview: false }, conversations: [], fresh: [], reconnecting: false })
          return
        }
        const picked = pickNew(d.conversations, d.serverTime, readMemory(memoryKey), visible() ? openConversation() : null)
        writeMemory(memoryKey, picked.memory)
        const { signedIn: _s, serverTime: _t, ...rest } = d
        publish({ ...rest, fresh: picked.fresh, reconnecting: false })
        if (picked.fresh.length) {
          if (d.settings.sound) beep()
          if (desktopWanted(userId) && !someTabFocused()) {
            for (const c of picked.fresh.slice(0, VISIBLE_TOASTS)) void showDesktopNotification(alertTitle(c, showCompany), desktopBody(c, d.settings.desktopPreview), c.id)
          }
        }
      } catch {
        if (stopped) return
        failures++
        const last = stateRef.current
        if (last && !last.reconnecting) publish({ ...last, fresh: [], reconnecting: true })
      } finally {
        clearTimeout(limit); running = false; schedule()
      }
    }
    const pokeLeader = () => { if (leader) void tick(); else channel?.postMessage({ type: 'poke' } satisfies Channel) }

    if (channel) channel.onmessage = (e: MessageEvent<Channel>) => {
      if (e.data.type === 'state') apply(e.data.state)
      else if (leader) void tick()
    }

    const acquire = (steal: boolean) => {
      const mine = ++generation
      queued?.abort(); queued = null
      if (!steal) queued = new AbortController()
      locks!.request(`erp-chat-poll-${userId}`, steal ? { steal: true } : { signal: queued!.signal }, () => new Promise<void>((resolve) => {
        if (stopped || mine !== generation) { resolve(); return }
        leader = true; release = resolve; void tick()
      })).catch(() => { /* taken over by the tab being looked at, or this page closed */ }).finally(() => {
        if (mine === generation && !stopped) { leader = false; release = null; clearTimeout(timer); acquire(false) }
      })
    }
    if (locks) acquire(false)
    else { leader = true; void tick() } // older browsers: each tab polls, and the stored memory still stops repeated alerts

    const onVisible = () => {
      if (!visible()) return
      if (locks && !leader) acquire(true)
      else { clearTimeout(timer); void tick() }
    }
    const onOnline = () => { failures = 0; pokeLeader() }
    const onRead = (e: Event) => { if (stateRef.current?.conversations.some((c) => c.id === (e as CustomEvent<string>).detail)) pokeLeader() }
    const onFocus = () => { try { localStorage.setItem(focusKey, '1') } catch { /* optional */ } }
    const onBlur = () => { try { localStorage.removeItem(focusKey) } catch { /* optional */ } }
    const unlockAudio = () => { audio ??= new AudioContext() } // browsers allow sound only after the person has interacted with the page
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener(CHAT_READ_EVENT, onRead)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onBlur)
    window.addEventListener('pointerdown', unlockAudio, { once: true })
    if (document.hasFocus()) onFocus()
    return () => {
      stopped = true; clearTimeout(timer); generation++; queued?.abort(); release?.(); channel?.close(); onBlur()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener(CHAT_READ_EVENT, onRead)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onBlur)
      window.removeEventListener('pointerdown', unlockAudio)
      void audio?.close()
    }
  }, [userId, showCompany])

  // Each alert disappears by itself; the badge keeps the count.
  useEffect(() => {
    if (!toasts.length) return
    const t = setTimeout(() => setToasts((old) => old.slice(0, -1)), TOAST_MS)
    return () => clearTimeout(t)
  }, [toasts])

  const total = state?.total ?? 0
  const listed = state?.conversations.filter((c) => !c.muted) ?? []
  const dismiss = (id: string) => setToasts((old) => old.filter((t) => t.id !== id))
  return (
    <>
      <HeaderMenu summaryClassName="flex cursor-pointer list-none items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
        summaryLabel={total ? `Chat, ${total} unread` : 'Chat, no unread messages'} panelClassName="p-2 sm:w-80"
        summary={<>
          <Icon name="messages" className="h-5 w-5" />
          {total > 0 && <span data-testid="chat-unread-badge" className="rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{badgeText(total)}</span>}
        </>}>
        <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Unread chat{state?.reconnecting ? ' · reconnecting…' : ''}</p>
        {listed.length === 0 ? <p className="p-2 text-slate-500">No unread messages.</p> : (
          <ul data-testid="chat-unread-list">{listed.slice(0, 8).map((c) => (
            <li key={c.id}><Link className="flex justify-between gap-2 rounded-lg px-2 py-2 text-slate-700 no-underline hover:bg-slate-50" href={conversationHref(c.id)}>
              <span className="min-w-0"><span className="block truncate font-medium">{alertTitle(c, showCompany)}</span><span className="block truncate text-xs text-slate-500">{c.latest.preview}</span></span>
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-xs font-semibold">{badgeText(c.unread)}</span>
            </Link></li>))}</ul>
        )}
        <Link className="block rounded-lg px-2 py-2 font-medium no-underline hover:bg-slate-50" href="/chat">Open Chat</Link>
        <Link className="block rounded-lg px-2 py-2 font-medium no-underline hover:bg-slate-50" href="/my-notifications/preferences">Chat alert settings</Link>
      </HeaderMenu>
      {toasts.length > 0 && createPortal( // on <body>: the blurred header would otherwise become the frame these are positioned in
        <div data-testid="chat-toasts" role="status" aria-live="polite" className="pointer-events-none fixed right-3 top-[calc(env(safe-area-inset-top)+4rem)] z-50 grid w-[min(22rem,calc(100vw-1.5rem))] grid-cols-1 gap-2">
          {toasts.slice(0, VISIBLE_TOASTS).map((c) => (
            <div key={c.latest.id} data-testid="chat-toast" className="card pointer-events-auto flex items-start gap-2 p-3 text-sm shadow-lg">
              <Link href={conversationHref(c.id)} onClick={() => dismiss(c.id)} className="min-w-0 flex-1 text-slate-800 no-underline">
                <span className="block truncate font-semibold">{alertTitle(c, showCompany)}</span>
                <span className="block truncate text-slate-600">{toastBody(c)}</span>
              </Link>
              <button type="button" className="btn-ghost btn-sm" aria-label="Dismiss" onClick={() => dismiss(c.id)}>×</button>
            </div>))}
          {toasts.length > VISIBLE_TOASTS && <p className="card pointer-events-auto p-2 text-center text-xs text-slate-600">{toasts.length - VISIBLE_TOASTS} more conversation{toasts.length - VISIBLE_TOASTS === 1 ? '' : 's'} with new messages</p>}
        </div>,
        document.body,
      )}
    </>
  )
}
