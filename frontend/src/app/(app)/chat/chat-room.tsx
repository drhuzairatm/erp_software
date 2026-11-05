'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { chatDeleteAction, chatEditAction, chatForwardAction, chatMemberAction, chatPinAction, chatReactAction, chatSyncGroupAction, sendMessageAction } from '@/app/actions/chat'
import { ActionForm, SubmitButton } from '@/components/forms'
import { Avatar, staffPhotoUrl } from '@/components/ui'
import type { ChatMessage } from '@/services/chat'

type Sync = { messages: ChatMessage[]; typing: string[]; members: { user_id: string; full_name: string; role: string; online: boolean }[]; pinned: { id: string; body: string; sender_name: string }[]; hasMore: boolean }
const POLL_MS = 3000
const time = (d: Date | string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(d))

export function ChatRoom({ conversationId, title, kind, groupType, isAdmin, me, orgPeople, reactions, others, tasks }: {
  conversationId: string; title: string; kind: string; groupType: string | null; isAdmin: boolean; me: string; orgPeople: { id: string; full_name: string }[]; reactions: string[]; others: { id: string; title: string }[]; tasks: { id: string; title: string }[]
}) {
  const [data, setData] = useState<Sync | null>(null)
  const [older, setOlder] = useState<ChatMessage[]>([])
  const [offline, setOffline] = useState(false)
  const [gone, setGone] = useState(false)
  const [reply, setReply] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [forwarding, setForwarding] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)
  const typingRef = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const lastId = useRef<string | null>(null)

  const sync = useCallback(async () => {
    try {
      const q = new URLSearchParams({ c: conversationId, read: document.visibilityState === 'visible' ? '1' : '0', typing: typingRef.current ? '1' : '0' })
      typingRef.current = false
      const res = await fetch(`/api/chat/sync?${q}`, { cache: 'no-store' })
      if (res.status === 404) { setGone(true); return } // removed from the conversation, or signed out
      if (!res.ok) throw new Error('sync failed')
      setData(await res.json()); setOffline(false)
    } catch { setOffline(true) }
  }, [conversationId])

  useEffect(() => {
    if (gone) return
    const first = setTimeout(() => { void sync() }, 0)
    const t = setInterval(() => { void sync() }, POLL_MS)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [sync, gone])
  useEffect(() => {
    const last = data?.messages[data.messages.length - 1]?.id ?? null
    if (last && last !== lastId.current) { lastId.current = last; if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight }
  }, [data])

  const act = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    const r = await fn(); setNotice(r.ok ? null : r.message ?? 'That could not be done.'); await sync()
  }
  const loadOlder = async () => {
    const first = older[0] ?? data?.messages[0]
    if (!first) return
    const res = await fetch(`/api/chat/sync?${new URLSearchParams({ c: conversationId, before: new Date(first.created_at).toISOString() })}`, { cache: 'no-store' })
    if (res.ok) { const d = await res.json() as Sync; setOlder((o) => [...d.messages, ...o]) }
  }
  const all = [...older, ...(data?.messages ?? [])]
  const memberIds = new Set(data?.members.map((m) => m.user_id))
  const others2 = (data?.members.length ?? 1) - 1
  const onlineOther = kind === 'direct' && data?.members.find((m) => m.user_id !== me)?.online

  if (gone) return <div role="alert" className="card p-8 text-center text-sm text-slate-600">You are no longer part of this conversation. <Link href="/chat">Back to conversations</Link></div>

  return (
    <div className="card flex h-[calc(100dvh-5.5rem)] flex-col lg:h-[calc(100dvh-12rem)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
        <div className="min-w-0"><Link href="/chat" className="text-xs lg:hidden">Back to conversations</Link>
          <h2 className="truncate font-semibold">{title}</h2>
          <p className="text-xs text-slate-500" data-testid="chat-status">{data?.typing.length ? `${data.typing.join(', ')} typing…` : kind === 'direct' ? (onlineOther ? 'Online' : 'Offline') : `${data?.members.length ?? 0} members`}</p></div>
        {kind === 'group' && <details className="text-sm"><summary className="cursor-pointer">Members</summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">{data?.members.map((m) => <li key={m.user_id} className="flex items-center justify-between gap-2"><span>{m.full_name}{m.role === 'admin' ? ' (admin)' : ''}{m.online ? ' · online' : ''}</span>
            {isAdmin && m.user_id !== me && <button type="button" className="btn-ghost btn-sm" onClick={() => void act(() => chatMemberAction(conversationId, m.user_id, false))}>Remove</button>}</li>)}</ul>
          {isAdmin && <select aria-label="Add a member" className="input mt-2" defaultValue="" onChange={(e) => { if (e.target.value) { const v = e.target.value; e.target.value = ''; void act(() => chatMemberAction(conversationId, v, true)) } }}><option value="">Add a member…</option>{orgPeople.filter((p) => !memberIds.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>}
          {isAdmin && (groupType === 'all_employees' || groupType === 'core_team') && <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => void act(() => chatSyncGroupAction(conversationId))}>Refresh members from the company</button>}
          {!isAdmin && <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => void act(() => chatMemberAction(conversationId, me, false))}>Leave group</button>}
        </details>}
      </header>
      {offline && <p role="alert" className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">Connection lost. Trying again…</p>}
      {notice && <p role="alert" className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-900">{notice}</p>}
      {(data?.pinned.length ?? 0) > 0 && <ul className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs" aria-label="Pinned messages">{data?.pinned.map((p) => <li key={p.id} className="truncate">📌 <strong>{p.sender_name}:</strong> {p.body}</li>)}</ul>}
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite" data-testid="chat-messages">
        {data?.hasMore && older.length === 0 && <button type="button" className="btn-ghost btn-sm mx-auto block" onClick={() => void loadOlder()}>Load earlier messages</button>}
        {data === null && <p className="text-center text-sm text-slate-500">Loading…</p>}
        {data && all.length === 0 && <p className="text-center text-sm text-slate-500">No messages yet. Say hello.</p>}
        {all.map((m) => {
          const mine = m.sender_id === me
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`} data-testid="chat-message">
              <Avatar name={m.sender_name} size="sm" src={staffPhotoUrl(m.sender_id, m.sender_photo)} />
              <div className={`min-w-0 max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-brand-50' : 'bg-slate-100'}`}>
                {!mine && kind === 'group' && <p className="text-xs font-semibold">{m.sender_name}</p>}
                {m.forwarded && <p className="text-xs italic text-slate-500">Forwarded</p>}
                {m.reply_to_id && <p className="mb-1 border-l-2 border-slate-300 pl-2 text-xs text-slate-600"><strong>{m.reply_sender}:</strong> {m.reply_preview}</p>}
                {m.deleted_at ? <p className="italic text-slate-500">Message deleted</p> : editing === m.id ? (
                  <div className="space-y-1"><label className="sr-only" htmlFor={`edit-${m.id}`}>Edit message</label><textarea id={`edit-${m.id}`} className="input" value={editText} maxLength={4000} onChange={(e) => setEditText(e.target.value)} />
                    <div className="flex gap-1"><button type="button" className="btn-primary btn-sm" onClick={() => { setEditing(null); void act(() => chatEditAction(m.id, editText)) }}>Save</button><button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button></div></div>
                ) : <p className="whitespace-pre-wrap wrap-anywhere">{m.body}</p>}
                {m.task_id && <Link className="mt-1 block text-xs" href={`/tasks/${m.task_id}`}>Task: {m.task_title ?? 'Open task'}</Link>}
                {m.files.map((f) => <a key={f.id} className="mt-1 block text-xs wrap-anywhere" href={`/api/secure-files/${f.id}`} target="_blank" rel="noopener">📎 {f.name} {f.scan === 'clean' ? '' : '(not virus-scanned)'}</a>)}
                <p className="mt-1 text-[11px] text-slate-500">{time(m.created_at)}{m.edited_at && !m.deleted_at ? ' · edited' : ''}{m.pinned_at ? ' · pinned' : ''}
                  {mine && !m.deleted_at && <span data-testid="receipt"> · {others2 > 0 && m.read >= others2 ? 'Read' : m.read > 0 ? `Read by ${m.read}` : m.delivered > 0 ? 'Delivered' : 'Sent'}</span>}</p>
                {m.reactions.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{m.reactions.map((r) => <button key={r.emoji} type="button" aria-pressed={r.mine} className={`rounded-full border px-1.5 text-xs ${r.mine ? 'border-brand-600 bg-white' : 'border-slate-200'}`} onClick={() => void act(() => chatReactAction(m.id, r.emoji, !r.mine))}>{r.emoji} {r.count}</button>)}</div>}
                {!m.deleted_at && <details className="mt-1 text-xs"><summary className="cursor-pointer text-slate-500">More</summary>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {reactions.map((e) => <button key={e} type="button" aria-label={`React ${e}`} className="rounded border border-slate-200 px-1" onClick={() => void act(() => chatReactAction(m.id, e, true))}>{e}</button>)}
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setReply(m)}>Reply</button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setForwarding(forwarding === m.id ? null : m.id)}>Forward</button>
                    {(kind === 'direct' || isAdmin) && <button type="button" className="btn-ghost btn-sm" onClick={() => void act(() => chatPinAction(m.id, !m.pinned_at))}>{m.pinned_at ? 'Unpin' : 'Pin'}</button>}
                    {mine && <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditing(m.id); setEditText(m.body) }}>Edit</button>}
                    {(mine || isAdmin) && <button type="button" className="btn-ghost btn-sm text-red-700" onClick={() => { if (window.confirm('Delete this message?')) void act(() => chatDeleteAction(m.id)) }}>Delete</button>}
                  </div>
                  {forwarding === m.id && <select aria-label="Forward to" className="input mt-1" defaultValue="" onChange={(e) => { const v = e.target.value; if (v) { setForwarding(null); void act(() => chatForwardAction(m.id, v)) } }}><option value="">Forward to…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select>}
                </details>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="border-t border-slate-100 p-3">
        {reply && <p className="mb-2 flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1 text-xs"><span className="truncate">Replying to {reply.sender_name}: {reply.body}</span><button type="button" className="btn-ghost btn-sm" onClick={() => setReply(null)}>Cancel</button></p>}
        <ActionForm key={formKey} action={sendMessageAction.bind(null, conversationId)} className="flex flex-wrap items-end gap-2" onSuccess={() => { setFormKey((k) => k + 1); setReply(null); void sync() }}>
          <input type="hidden" name="replyTo" value={reply?.id ?? ''} />
          {tasks.length > 0 && <div className="w-full"><label className="sr-only" htmlFor="chat-task">About a task</label>
            <select id="chat-task" name="taskId" className="input text-xs" defaultValue=""><option value="">No task linked</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></div>}
          <div className="w-full min-w-0 sm:w-auto sm:flex-1"><label className="sr-only" htmlFor="chat-body">Message</label>
            <textarea id="chat-body" name="body" rows={2} maxLength={4000} className="input" placeholder="Write a message. Use @name to mention someone." onChange={() => { typingRef.current = true }} /></div>
          <div className="min-w-0 flex-1 sm:flex-none"><label className="sr-only" htmlFor="chat-file">Attach a file</label><input id="chat-file" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="block w-full max-w-full sm:max-w-40 text-xs file:mr-1 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs" /></div>
          <SubmitButton className="btn-primary btn-sm" pendingText="Sending…">Send</SubmitButton>
        </ActionForm>
      </div>
    </div>
  )
}
