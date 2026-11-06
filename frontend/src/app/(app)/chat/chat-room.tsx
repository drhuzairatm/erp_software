'use client'

import Link from 'next/link'
import { unstable_rethrow } from 'next/navigation'
import { type ChangeEvent, type KeyboardEvent, type MouseEvent, type SyntheticEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { chatDeleteAction, chatEditAction, chatForwardAction, chatMemberAction, chatMuteAction, chatPinAction, chatReactAction, chatSyncGroupAction, sendMessageAction } from '@/app/actions/chat'
import type { ActionResult } from '@/components/action-types'
import { ActionForm, SubmitButton, usePending } from '@/components/forms'
import { CHAT_READ_EVENT } from '@/components/chat-notify-logic'
import { Avatar, staffPhotoUrl } from '@/components/ui'
import type { ChatMessage } from '@/services/chat'
import { Icon, Ticks } from './chat-icons'

type Member = { user_id: string; full_name: string; role: string; online: boolean }
type Sync = { messages: ChatMessage[]; typing: string[]; members: Member[]; pinned: { id: string; body: string; sender_name: string }[]; hasMore: boolean }
type PickedFile = { name: string; size: number; url: string | null }
const POLL_MS = 3000
const TZ = 'Asia/Kolkata'
// Below the 10 MB request buffer: a larger upload fails before the server can give a clear message.
const MAX_FILE_BYTES = 10 * 1024 * 1024
const GROUP_GAP_MS = 5 * 60 * 1000
const EMOJI = ['😀', '😄', '😁', '😂', '🙂', '😉', '😊', '😍', '🤔', '😅', '😮', '😢', '😡', '👍', '👎', '👏', '🙏', '🤝', '💪', '👌', '✌️', '❤️', '🎉', '✅', '❌', '⚠️', '⭐', '🔥', '📌', '📎', '📄', '📅', '⏰', '📞', '✉️', '💡', '🎓', '🏥', '✈️', '🌍']

const clock = (d: Date | string) => new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: TZ }).format(new Date(d))
const fullTime = (d: Date | string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(new Date(d))
const dayKey = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d))
function dayLabel(d: Date | string) {
  const now = Date.now()
  if (dayKey(d) === dayKey(new Date(now))) return 'Today'
  if (dayKey(d) === dayKey(new Date(now - 86_400_000))) return 'Yesterday'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeZone: TZ }).format(new Date(d))
}
const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`)
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

/** The message box. Enter submits the form, so it follows the same path as the Send button; Shift+Enter starts a new line. */
function MessageBox({ onEnterSend, onTyping, members }: { onEnterSend: () => void; onTyping: () => void; members: Member[] }) {
  const pending = usePending()
  // Set at once, because "pending" only arrives with the next render and the form would queue a second submission.
  const submitting = useRef(false)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  useEffect(() => { if (!pending) submitting.current = false }, [pending])
  const q = query?.toLowerCase() ?? null
  const suggestions = q === null ? [] : members.filter((m) => { const n = m.full_name.toLowerCase(); return n !== q && (n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q))) }).slice(0, 6)
  const grow = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 128)}px` }
  const pick = (name: string) => {
    const box = document.getElementById('chat-body') as HTMLTextAreaElement
    const caret = box.selectionStart
    const at = box.value.slice(0, caret).lastIndexOf('@')
    box.setRangeText(`@${name} `, at, caret, 'end')
    setQuery(null); grow(box); box.focus(); onTyping()
  }
  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    grow(e.target); onTyping()
    // Letters only, so an email address or ordinary text after a finished name closes the list.
    const m = /(?:^|\s)@([\p{L}\p{M}.' -]{0,30})$/u.exec(e.target.value.slice(0, e.target.selectionStart))
    setQuery(m ? m[1] : null); setActive(0)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); return }
      if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); pick(suggestions[active].full_name); return }
    }
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.nativeEvent.isComposing || e.keyCode === 229) return // this Enter is choosing a word in an input method
    if (pending || submitting.current || e.repeat) { e.preventDefault(); return }
    const form = e.currentTarget.form!
    const file = form.elements.namedItem('file') as HTMLInputElement | null
    if (!e.currentTarget.value.trim() && !file?.files?.length) return // nothing to send
    e.preventDefault()
    submitting.current = true; onEnterSend()
    form.requestSubmit()
  }
  // Read-only while sending: the box is cleared when the send succeeds, which would lose anything typed in between.
  return (
    <div className="relative">
      {suggestions.length > 0 && <ul aria-label="People to mention" className="absolute bottom-full left-0 z-30 mb-1 w-64 max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
        {suggestions.map((m, i) => <li key={m.user_id}><button type="button" className={`block w-full truncate px-3 py-1.5 text-left hover:bg-slate-50 ${i === active ? 'bg-brand-50' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m.full_name)}>{m.full_name}</button></li>)}
      </ul>}
      <textarea id="chat-body" name="body" rows={1} maxLength={4000} className="input max-h-32 resize-none" enterKeyHint="send" readOnly={pending} placeholder="Write a message" title="Use @name to mention someone" onChange={onChange} onKeyDown={onKeyDown} />
    </div>
  )
}

export function ChatRoom({ conversationId, title, kind, groupType, isAdmin, me, orgPeople, reactions, others, tasks, muted: initialMuted, orgName, initialUnread, jump, photo }: {
  muted: boolean; conversationId: string; title: string; kind: string; groupType: string | null; isAdmin: boolean; me: string; orgPeople: { id: string; full_name: string }[]; reactions: string[]; others: { id: string; title: string }[]; tasks: { id: string; title: string }[]
  orgName: string; initialUnread: number; jump: string | null; photo: string | null
}) {
  const [data, setData] = useState<Sync | null>(null)
  const [muted, setMuted] = useState(initialMuted)
  // Everything seen so far, by id. A message that scrolls out of the latest page stays on screen, so older pages never leave a gap.
  const [all, setAll] = useState<ChatMessage[]>([])
  const known = useRef(new Map<string, ChatMessage>())
  const [olderMore, setOlderMore] = useState<boolean | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [unreadFrom, setUnreadFrom] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [gone, setGone] = useState(false)
  const [reply, setReply] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [forwarding, setForwarding] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [picked, setPicked] = useState<PickedFile | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const typingRef = useRef(false)
  const refocusBox = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const lastId = useRef<string | null>(null)
  const firstSync = useRef(true)
  const restore = useRef<{ height: number; top: number } | null>(null)
  const olderBusy = useRef(false)

  const merge = useCallback((list: ChatMessage[]) => {
    for (const m of list) known.current.set(m.id, m)
    setAll([...known.current.values()].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id)))
  }, [])

  const sync = useCallback(async () => {
    try {
      const q = new URLSearchParams({ c: conversationId, read: document.visibilityState === 'visible' ? '1' : '0', typing: typingRef.current ? '1' : '0' })
      typingRef.current = false
      const res = await fetch(`/api/chat/sync?${q}`, { cache: 'no-store' })
      if (res.status === 404) { setGone(true); return } // removed from the conversation, or signed out
      if (!res.ok) throw new Error('sync failed')
      const d = await res.json() as Sync
      if (firstSync.current) {
        firstSync.current = false
        // Where the unread messages begin, worked out once: this same request marks them read.
        let left = initialUnread
        for (let i = d.messages.length - 1; i >= 0 && left > 0; i--) {
          if (d.messages[i].sender_id === me || d.messages[i].deleted_at) continue
          left--
          if (left === 0 || i === 0) setUnreadFrom(d.messages[i].id)
        }
      }
      merge(d.messages); setData(d); setOffline(false)
      if (q.get('read') === '1') window.dispatchEvent(new CustomEvent(CHAT_READ_EVENT, { detail: conversationId })) // the header badge catches up at once
    } catch { setOffline(true) }
  }, [conversationId, initialUnread, me, merge])

  useEffect(() => {
    if (gone) return
    const first = setTimeout(() => { void sync() }, 0)
    const t = setInterval(() => { void sync() }, POLL_MS)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [sync, gone])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (restore.current) { el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top; restore.current = null; return }
    const last = all[all.length - 1]
    if (!last || last.id === lastId.current) return
    const opening = lastId.current === null
    lastId.current = last.id
    if (opening) {
      const divider = document.getElementById('chat-unread-divider')
      if (divider) divider.scrollIntoView({ block: 'start' }); else el.scrollTop = el.scrollHeight
    } else if (last.sender_id === me || atBottom) el.scrollTop = el.scrollHeight // someone reading older messages is not pulled away
  }, [all, atBottom, me])

  // A menu closes when the person clicks elsewhere.
  useEffect(() => {
    const onDown = (e: PointerEvent) => { for (const d of document.querySelectorAll<HTMLDetailsElement>('details[data-chat-popover][open]')) if (!d.contains(e.target as Node)) d.open = false }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

  // The form is rebuilt after a send; the cursor returns to the box so the next message can be typed straight away.
  useEffect(() => { if (refocusBox.current) { refocusBox.current = false; document.getElementById('chat-body')?.focus() } }, [formKey])
  useEffect(() => () => { if (picked?.url) URL.revokeObjectURL(picked.url) }, [picked])

  // A connection failure rejects instead of returning a result. Reported here, the form and the typed message stay on screen.
  const send = async (prev: ActionResult, fd: FormData): Promise<ActionResult> => {
    try { return await sendMessageAction(conversationId, prev, fd) } catch (e) {
      unstable_rethrow(e) // a redirect, such as an expired session
      return { ok: false, message: 'The message was not sent. Check your connection and try again.' }
    }
  }
  const act = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    const r = await fn(); setNotice(r.ok ? null : r.message ?? 'That could not be done.'); await sync()
  }
  const loadOlder = useCallback(async () => {
    if (olderBusy.current) return false
    const earliest = [...known.current.values()].reduce<ChatMessage | null>((a, m) => (!a || new Date(m.created_at) < new Date(a.created_at) ? m : a), null)
    if (!earliest) return false
    olderBusy.current = true; setLoadingOlder(true)
    try {
      const res = await fetch(`/api/chat/sync?${new URLSearchParams({ c: conversationId, before: new Date(earliest.created_at).toISOString() })}`, { cache: 'no-store' })
      if (!res.ok) return false
      const d = await res.json() as Sync
      const el = scroller.current
      if (el) restore.current = { height: el.scrollHeight, top: el.scrollTop }
      merge(d.messages); setOlderMore(d.hasMore)
      return d.hasMore
    } catch { return false } finally { olderBusy.current = false; setLoadingOlder(false) }
  }, [conversationId, merge])
  /** Brings a message into view, loading a limited number of older pages if it is not on screen yet. */
  const jumpTo = useCallback(async (id: string) => {
    let el = document.getElementById(`chat-msg-${id}`)
    for (let i = 0; !el && i < 10; i++) {
      const more = await loadOlder()
      await nextFrame()
      el = document.getElementById(`chat-msg-${id}`)
      if (!more) break
    }
    if (!el) { setNotice('That message could not be found. It may have been removed.'); return }
    el.scrollIntoView({ block: 'center' }); setHighlight(id)
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2500)
  }, [loadOlder])
  const hasData = data !== null
  useEffect(() => {
    if (!jump || !hasData) return
    const t = setTimeout(() => { void jumpTo(jump) }, 0)
    return () => clearTimeout(t)
  }, [jump, hasData, jumpTo])

  const canLoadOlder = olderMore ?? data?.hasMore ?? false
  const onScroll = (e: SyntheticEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
    if (el.scrollTop < 60 && canLoadOlder && lastId.current) void loadOlder()
  }
  const toLatest = () => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight }
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f && f.size >= MAX_FILE_BYTES) { e.target.value = ''; setPicked(null); setNotice('The file must be smaller than 10 MB.'); return }
    setNotice(null)
    setPicked(f ? { name: f.name, size: f.size, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null } : null)
  }
  const removeFile = () => { const input = document.getElementById('chat-file') as HTMLInputElement | null; if (input) input.value = ''; setPicked(null) }
  const addEmoji = (emoji: string) => {
    const box = document.getElementById('chat-body') as HTMLTextAreaElement | null
    if (!box || box.readOnly) return
    box.setRangeText(emoji, box.selectionStart, box.selectionEnd, 'end'); box.focus(); typingRef.current = true
  }
  // Choosing an action closes the message menu. Forward stays open, because it still needs a conversation.
  const closeMenu = (e: MouseEvent<HTMLDivElement>) => {
    const b = (e.target as HTMLElement).closest('button')
    if (b && !b.dataset.keepOpen) { const d = e.currentTarget.closest('details'); if (d) d.open = false }
  }
  const memberIds = new Set(data?.members.map((m) => m.user_id))
  const others2 = (data?.members.length ?? 1) - 1
  const onlineOther = kind === 'direct' && data?.members.find((m) => m.user_id !== me)?.online
  const status = data?.typing.length ? `${data.typing.join(', ')} typing…` : kind === 'direct' ? (onlineOther ? 'Online' : 'Offline') : `${data?.members.length ?? 0} members`

  if (gone) return <div role="alert" className="m-auto p-8 text-center text-sm text-slate-600">You are no longer part of this conversation. <Link href="/chat">Back to conversations</Link></div>

  const panelClass = 'absolute inset-x-0 bottom-0 top-[3.75rem] z-30 overflow-y-auto border-l border-slate-200 bg-white p-4 text-sm shadow-lg sm:left-auto sm:w-80'
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-slate-100">
      <div className="flex min-h-[3.75rem] items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 py-2 sm:px-3" data-testid="chat-header">
        <Link href="/chat" aria-label="Back to conversations" className="btn-ghost btn-sm px-1 lg:hidden"><Icon name="back" /></Link>
        <span className="relative shrink-0"><Avatar name={title} size="md" src={photo} />{onlineOther && <span aria-hidden className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-slate-50" />}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2>
          <p className={`truncate text-xs ${data?.typing.length ? 'font-medium text-brand-700' : 'text-slate-500'}`} data-testid="chat-status">{status}</p>
        </div>
        <button type="button" className="btn-ghost btn-sm px-2" aria-pressed={muted} title={muted ? 'Unmute alerts' : 'Mute alerts'} onClick={() => void act(async () => { const r = await chatMuteAction(conversationId, !muted); if (r.ok) setMuted(!muted); return r })}><Icon name={muted ? 'mute' : 'bell'} className="h-4 w-4" /><span className="sr-only">{muted ? 'Unmute alerts' : 'Mute alerts'}</span></button>
        {kind === 'group' ? (
          <details className="text-sm" onToggle={(e) => setInfoOpen(e.currentTarget.open)}><summary className="btn-ghost btn-sm cursor-pointer list-none"><Icon name="group" className="h-4 w-4" /><span className="max-sm:sr-only">Members</span></summary>
            <div className={panelClass}>
              <h3 className="font-semibold text-slate-900">Group info</h3>
              <p className="mb-3 text-xs text-slate-500">{orgName} · {data?.members.length ?? 0} members</p>
              <ul className="space-y-1">{data?.members.map((m) => <li key={m.user_id} className="flex items-center justify-between gap-2 py-0.5"><span className="flex min-w-0 items-center gap-2"><Avatar name={m.full_name} size="sm" /><span className="min-w-0 truncate">{m.full_name}{m.role === 'admin' ? ' (admin)' : ''}{m.online ? ' · online' : ''}</span></span>
                {isAdmin && m.user_id !== me && <button type="button" className="btn-ghost btn-sm" onClick={() => void act(() => chatMemberAction(conversationId, m.user_id, false))}>Remove</button>}</li>)}</ul>
              {isAdmin && <select aria-label="Add a member" className="input mt-3" defaultValue="" onChange={(e) => { if (e.target.value) { const v = e.target.value; e.target.value = ''; void act(() => chatMemberAction(conversationId, v, true)) } }}><option value="">Add a member…</option>{orgPeople.filter((p) => !memberIds.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>}
              {isAdmin && (groupType === 'all_employees' || groupType === 'core_team') && <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => void act(() => chatSyncGroupAction(conversationId))}>Refresh members from the company</button>}
              {!isAdmin && <button type="button" className="btn-ghost btn-sm mt-3 text-red-700" onClick={() => { if (window.confirm('Leave this group?')) void act(() => chatMemberAction(conversationId, me, false)) }}>Leave group</button>}
            </div>
          </details>
        ) : (
          <details className="text-sm" onToggle={(e) => setInfoOpen(e.currentTarget.open)}><summary className="btn-ghost btn-sm cursor-pointer list-none px-2" title="Contact info"><Icon name="info" className="h-4 w-4" /><span className="sr-only">Contact info</span></summary>
            <div className={panelClass}>
              <div className="flex flex-col items-center gap-2 text-center"><Avatar name={title} size="xl" src={photo} /><h3 className="font-semibold text-slate-900">{title}</h3><p className="text-xs text-slate-500">{orgName} · {onlineOther ? 'Online' : 'Offline'}</p></div>
            </div>
          </details>
        )}
      </div>
      {offline && <p role="alert" className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">Connection lost. Trying again…</p>}
      {notice && <p role="alert" className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-900"><span>{notice}</span><button type="button" aria-label="Dismiss" className="shrink-0" onClick={() => setNotice(null)}><Icon name="close" className="h-3.5 w-3.5" /></button></p>}
      {(data?.pinned.length ?? 0) > 0 && <ul className="max-h-20 overflow-y-auto border-b border-slate-200 bg-white px-3 py-1.5 text-xs" aria-label="Pinned messages">{data?.pinned.map((p) => <li key={p.id}><button type="button" className="block w-full truncate py-0.5 text-left hover:underline" onClick={() => void jumpTo(p.id)}>📌 <strong>{p.sender_name}:</strong> {p.body}</button></li>)}</ul>}
      <div className={`relative min-h-0 flex-1 ${infoOpen ? 'xl:mr-80' : ''}`}>
        <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-x-hidden overflow-y-auto px-2 py-3 sm:px-6" aria-live="polite" data-testid="chat-messages">
          {canLoadOlder && <button type="button" disabled={loadingOlder} className="btn-secondary btn-sm mx-auto mb-2 block" onClick={() => void loadOlder()}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
          {data === null && <div aria-label="Loading messages" className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className={`h-10 w-2/3 max-w-sm animate-pulse rounded-lg bg-slate-200 ${i % 2 ? 'ml-auto' : ''}`} />)}</div>}
          {data && all.length === 0 && <p className="mx-auto mt-8 w-fit rounded-lg bg-white px-4 py-2 text-center text-sm text-slate-500 shadow-sm">No messages yet. Say hello.</p>}
          {all.map((m, i) => {
            const mine = m.sender_id === me
            const prev = all[i - 1]
            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at)
            const showUnread = m.id === unreadFrom
            const continued = !!prev && !newDay && !showUnread && prev.sender_id === m.sender_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_GAP_MS
            const showIdentity = kind === 'group' && !mine
            const readState = others2 > 0 && m.read >= others2 ? 'read' : m.delivered > 0 ? 'delivered' : 'sent'
            return (
              <div key={m.id}>
                {newDay && <p className="my-3 text-center"><span className="rounded-lg bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm" suppressHydrationWarning>{dayLabel(m.created_at)}</span></p>}
                {showUnread && <p id="chat-unread-divider" className="my-3 scroll-mt-2 bg-white/70 py-1 text-center text-xs font-semibold text-brand-800">Unread messages</p>}
                <div id={`chat-msg-${m.id}`} className={`flex gap-2 ${mine ? 'justify-end' : ''} ${continued ? 'mt-0.5' : 'mt-2.5'}`} data-testid="chat-message">
                  {showIdentity && (continued ? <span aria-hidden className="w-7 shrink-0" /> : <Avatar name={m.sender_name} size="sm" src={staffPhotoUrl(m.sender_id, m.sender_photo)} />)}
                  <div className={`group/bubble relative min-w-0 max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm text-slate-900 shadow-sm transition-shadow lg:max-w-[65%] ${mine ? 'bg-brand-100' : 'bg-white'} ${highlight === m.id ? 'ring-2 ring-amber-400' : ''}`}>
                    {showIdentity && !continued && <p className="pr-5 text-xs font-semibold text-brand-800">{m.sender_name}</p>}
                    {m.forwarded && <p className="pr-5 text-xs italic text-slate-500">Forwarded</p>}
                    {m.reply_to_id && <button type="button" className="mb-1 block w-full rounded border-l-4 border-brand-500 bg-black/5 px-2 py-1 text-left text-xs text-slate-700" onClick={() => void jumpTo(m.reply_to_id!)}><strong className="block text-brand-800">{m.reply_sender}</strong><span className="line-clamp-2 wrap-anywhere">{m.reply_preview}</span></button>}
                    {m.deleted_at ? <p className="italic text-slate-500">Message deleted</p> : editing === m.id ? (
                      <div className="space-y-1"><label className="sr-only" htmlFor={`edit-${m.id}`}>Edit message</label><textarea id={`edit-${m.id}`} className="input" value={editText} maxLength={4000} onChange={(e) => setEditText(e.target.value)} />
                        <div className="flex gap-1"><button type="button" className="btn-primary btn-sm" onClick={() => { setEditing(null); void act(() => chatEditAction(m.id, editText)) }}>Save</button><button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button></div></div>
                    ) : m.body ? <p className="whitespace-pre-wrap pr-4 wrap-anywhere">{m.body}</p> : null}
                    {m.task_id && <Link className="mt-1 block rounded bg-black/5 px-2 py-1 text-xs" href={`/tasks/${m.task_id}`}>Task: {m.task_title ?? 'Open task'}</Link>}
                    {m.files.map((f) => <a key={f.id} className="mt-1 flex items-center gap-2 rounded bg-black/5 px-2 py-1.5 text-xs no-underline" href={`/api/secure-files/${f.id}`} target="_blank" rel="noopener"><Icon name="file" className="h-5 w-5 text-brand-700" /><span className="min-w-0 wrap-anywhere">{f.name} {f.scan === 'clean' ? '' : <span className="text-slate-500">(not virus-scanned)</span>}</span></a>)}
                    <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-slate-500" title={fullTime(m.created_at)}>{m.edited_at && !m.deleted_at && <span>edited ·</span>}{m.pinned_at && <span>pinned ·</span>}<span suppressHydrationWarning>{clock(m.created_at)}</span>
                      {mine && !m.deleted_at && <span data-testid="receipt"><Ticks state={readState} /><span className="sr-only">{others2 > 0 && m.read >= others2 ? 'Read' : m.read > 0 ? `Read by ${m.read}` : m.delivered > 0 ? 'Delivered' : 'Sent'}</span></span>}</p>
                    {m.reactions.length > 0 && <div className="-mb-0.5 mt-1 flex flex-wrap gap-1">{m.reactions.map((r) => <button key={r.emoji} type="button" aria-pressed={r.mine} className={`rounded-full border bg-white px-1.5 text-xs ${r.mine ? 'border-brand-600' : 'border-slate-200'}`} onClick={() => void act(() => chatReactAction(m.id, r.emoji, !r.mine))}>{r.emoji} {r.count}</button>)}</div>}
                    {!m.deleted_at && <details data-chat-popover className="static text-xs" onToggle={(e) => { if (e.currentTarget.open) e.currentTarget.lastElementChild?.scrollIntoView({ block: 'nearest' }) }}>
                      <summary className="absolute right-1 top-1 cursor-pointer list-none rounded-full bg-white/80 p-0.5 text-slate-500 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/bubble:opacity-100 group-has-[details[open]]/bubble:opacity-100 [@media(hover:none)]:opacity-100"><Icon name="chevron" className="h-4 w-4" /><span className="sr-only">More</span></summary>
                      <div onClick={closeMenu} className={`absolute top-full z-20 mt-1 w-60 max-w-[80vw] rounded-lg border border-slate-200 bg-white p-2 shadow-lg ${mine ? 'right-0' : 'left-0'}`}>
                        <div className="mb-1 flex flex-wrap gap-1 border-b border-slate-100 pb-1.5">{reactions.map((e) => <button key={e} type="button" aria-label={`React ${e}`} className="rounded px-1 text-base hover:bg-slate-100" onClick={() => void act(() => chatReactAction(m.id, e, true))}>{e}</button>)}</div>
                        <div className="flex flex-col items-stretch [&>button]:justify-start">
                          <button type="button" className="btn-ghost btn-sm" onClick={() => { setReply(m); document.getElementById('chat-body')?.focus() }}>Reply</button>
                          <button type="button" data-keep-open="true" className="btn-ghost btn-sm" onClick={() => setForwarding(forwarding === m.id ? null : m.id)}>Forward</button>
                          {(kind === 'direct' || isAdmin) && <button type="button" className="btn-ghost btn-sm" onClick={() => void act(() => chatPinAction(m.id, !m.pinned_at))}>{m.pinned_at ? 'Unpin' : 'Pin'}</button>}
                          {mine && <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditing(m.id); setEditText(m.body) }}>Edit</button>}
                          {(mine || isAdmin) && <button type="button" className="btn-ghost btn-sm text-red-700" onClick={() => { if (window.confirm('Delete this message?')) void act(() => chatDeleteAction(m.id)) }}>Delete</button>}
                        </div>
                        {forwarding === m.id && <select aria-label="Forward to" className="input mt-1" defaultValue="" onChange={(e) => { const v = e.target.value; if (v) { setForwarding(null); void act(() => chatForwardAction(m.id, v)) } }}><option value="">Forward to…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select>}
                      </div>
                    </details>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {!atBottom && <button type="button" aria-label="Go to latest messages" className="absolute bottom-3 right-3 z-10 rounded-full border border-slate-200 bg-white p-2 text-slate-600 shadow-md hover:bg-slate-50" onClick={toLatest}><Icon name="down" className="h-4 w-4" /></button>}
      </div>
      <div className={`border-t border-slate-200 bg-slate-50 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3 ${infoOpen ? 'xl:mr-80' : ''}`}>
        {reply && <div className="mb-2 flex items-center justify-between gap-2 rounded border-l-4 border-brand-500 bg-white px-2 py-1 text-xs"><span className="min-w-0"><strong className="block text-brand-800">Replying to {reply.sender_name}</strong><span className="block truncate text-slate-600">{reply.body}</span></span><button type="button" className="btn-ghost btn-sm" onClick={() => setReply(null)}>Cancel</button></div>}
        <ActionForm key={formKey} action={send} className="space-y-2" onSuccess={() => { setFormKey((k) => k + 1); setReply(null); setPicked(null); void sync() }}>
          <input type="hidden" name="replyTo" value={reply?.id ?? ''} />
          {tasks.length > 0 && <div><label className="sr-only" htmlFor="chat-task">About a task</label>
            <select id="chat-task" name="taskId" className="input py-1 text-xs" defaultValue=""><option value="">No task linked</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></div>}
          {picked && <div className="flex items-center gap-2 rounded border border-slate-200 bg-white p-1.5 text-xs" data-testid="chat-file-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {picked.url ? <img src={picked.url} alt={`Preview of ${picked.name}`} className="h-10 w-10 rounded object-cover" /> : <Icon name="file" className="h-6 w-6 text-brand-700" />}
            <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-900">{picked.name}</span><span className="text-slate-500">{fileSize(picked.size)}</span></span>
            <button type="button" className="btn-ghost btn-sm" onClick={removeFile}>Remove</button></div>}
          <div className="flex items-end gap-1">
            <details data-chat-popover className="relative shrink-0"><summary className="btn-ghost btn-sm cursor-pointer list-none px-2 py-2" title="Add an emoji"><Icon name="smile" /><span className="sr-only">Add an emoji</span></summary>
              <div className="absolute bottom-full left-0 z-30 mb-1 grid w-64 grid-cols-8 gap-0.5 rounded-lg border border-slate-200 bg-white p-2 shadow-lg" role="group" aria-label="Emoji">{EMOJI.map((e) => <button key={e} type="button" aria-label={`Insert ${e}`} className="rounded p-0.5 text-lg hover:bg-slate-100" onClick={() => addEmoji(e)}>{e}</button>)}</div>
            </details>
            <label htmlFor="chat-file" title="Attach a file" className="btn-ghost btn-sm shrink-0 cursor-pointer px-2 py-2"><Icon name="clip" /><span className="sr-only">Attach a file</span></label>
            <input id="chat-file" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} />
            <div className="min-w-0 flex-1"><label className="sr-only" htmlFor="chat-body">Message</label>
              <MessageBox members={(data?.members ?? []).filter((m) => m.user_id !== me)} onEnterSend={() => { refocusBox.current = true }} onTyping={() => { typingRef.current = true }} /></div>
            <SubmitButton className="btn-primary btn-sm shrink-0 rounded-full p-2" pendingText="Sending…"><Icon name="send" /><span className="sr-only">Send</span></SubmitButton>
          </div>
        </ActionForm>
      </div>
    </div>
  )
}
