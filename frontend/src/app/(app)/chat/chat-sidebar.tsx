'use client'

import Link from 'next/link'
import { type ReactNode, useMemo, useState } from 'react'
import { openDirectAction } from '@/app/actions/chat'
import { Avatar, staffPhotoUrl } from '@/components/ui'
import { Icon } from './chat-icons'

type Conversation = { id: string; kind: string; name: string | null; other_id: string | null; other_name: string | null; other_online: boolean; org_name: string; unread: number; last_at: Date | string | null; last_preview: string | null; muted: boolean; photo_version?: number | null }
type Result = { id: string; conversation_id: string; body: string; created_at: Date | string; sender_name: string }
type Filter = 'all' | 'unread' | 'personal' | 'groups' | 'muted'
const FILTERS: [Filter, string][] = [['all', 'All'], ['unread', 'Unread'], ['personal', 'Personal'], ['groups', 'Groups'], ['muted', 'Muted']]
const TZ = 'Asia/Kolkata'
const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

function listTime(v: Date | string | null) {
  if (!v) return ''
  const d = new Date(v); const now = new Date()
  if (dayOf(d) === dayOf(now)) return new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: TZ }).format(d)
  if (dayOf(d) === dayOf(new Date(now.getTime() - 86_400_000))) return 'Yesterday'
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', timeZone: TZ }).format(d)
}
/** Marks the search term in plain text. React escapes the text, so a message can never inject markup. */
function Highlight({ text, term }: { text: string; term: string }) {
  const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1
  if (at < 0) return <>{text}</>
  return <>{text.slice(0, at)}<mark className="rounded bg-amber-200 text-slate-900">{text.slice(at, at + term.length)}</mark>{text.slice(at + term.length)}</>
}

export function ChatSidebar({ hidden, meName, mePhoto, conversations, currentId, q, results, people, newGroup, governance }: {
  hidden: boolean; meName: string; mePhoto: string | null; conversations: Conversation[]; currentId: string | null; q: string; results: Result[]
  people: { id: string; full_name: string; org_id: string; org_name: string }[]; newGroup: ReactNode; governance: boolean
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [text, setText] = useState(q)
  const [who, setWho] = useState('')
  const title = (c: Conversation) => c.name ?? c.other_name ?? 'Conversation'
  const shown = useMemo(() => {
    const t = text.trim().toLowerCase()
    return conversations.filter((c) => (filter === 'all' || (filter === 'unread' && c.unread > 0) || (filter === 'personal' && c.kind === 'direct') || (filter === 'groups' && c.kind === 'group') || (filter === 'muted' && c.muted))
      && (!t || !!q || title(c).toLowerCase().includes(t)))
  }, [conversations, filter, text, q])
  const matches = people.filter((p) => p.full_name.toLowerCase().includes(who.trim().toLowerCase()))
  return (
    <aside className={`min-h-0 flex-col border-r border-slate-200 bg-white ${hidden ? 'hidden lg:flex' : 'flex'}`} aria-label="Conversations">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <Avatar name={meName} size="md" src={mePhoto} />
        <h1 className="min-w-0 flex-1 truncate font-semibold text-slate-900">Chat</h1>
        {governance && <Link className="btn-ghost btn-sm no-underline" href="/chat/governance" title="Chat governance"><Icon name="shield" className="h-4 w-4" /><span className="max-sm:sr-only">Governance</span></Link>}
      </div>
      <div className="relative shrink-0 space-y-2 border-b border-slate-100 p-2">
        <div className="flex flex-wrap gap-2 text-sm">
          <details className="group min-w-0 flex-1"><summary className="btn-secondary btn-sm w-full cursor-pointer list-none justify-center"><Icon name="chat" className="h-4 w-4" /><span>New chat</span></summary>
            <form action={openDirectAction} className="mt-2 space-y-2">
              <div><label className="label" htmlFor="chat-person-search">Find a person</label><input id="chat-person-search" className="input" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Type a name" autoComplete="off" /></div>
              <div><label className="label" htmlFor="chat-person">Direct message</label>
                <select className="input" id="chat-person" name="person" required size={Math.min(6, Math.max(2, matches.length))} defaultValue="">{matches.map((p) => <option key={`${p.org_id}${p.id}`} value={`${p.org_id}|${p.id}`}>{p.full_name} ({p.org_name})</option>)}</select></div>
              <button className="btn-primary btn-sm">Open</button>
            </form>
          </details>
          {newGroup}
        </div>
        <form className="relative" action="/chat">
          <label className="sr-only" htmlFor="chat-q">Search conversations and messages</label>
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-slate-400"><Icon name="search" className="h-4 w-4" /></span>
          <input className="input pl-8" id="chat-q" name="q" placeholder="Search names, or press Enter for messages" value={text} onChange={(e) => setText(e.target.value)} />
        </form>
        <div className="flex gap-1 overflow-x-auto pb-0.5" role="group" aria-label="Filter conversations">
          {FILTERS.map(([k, label]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${filter === k ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {q && <div className="border-b border-slate-200" data-testid="chat-search-results">
          <p className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600"><span>Messages matching “{q}”</span><Link href="/chat">Clear</Link></p>
          {results.length === 0 ? <p className="p-3 text-sm text-slate-500">No messages found.</p> : <ul className="divide-y divide-slate-100 text-sm">{results.map((r) => <li key={r.id}><Link className="block p-3 no-underline hover:bg-slate-50" href={`/chat?c=${r.conversation_id}&m=${r.id}&q=${encodeURIComponent(q)}`}><span className="block wrap-anywhere text-slate-900"><Highlight text={r.body} term={q} /></span><span className="text-xs text-slate-500" suppressHydrationWarning>{r.sender_name} · {listTime(r.created_at)}</span></Link></li>)}</ul>}
        </div>}
        {conversations.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No conversations yet. Use New chat to begin.</p>
          : <ul className="divide-y divide-slate-100" data-testid="conversation-list">
            {shown.map((c) => (
              <li key={c.id}><Link href={`/chat?c=${c.id}`} aria-current={c.id === currentId ? 'true' : undefined} className={`flex items-center gap-3 px-3 py-2.5 no-underline hover:bg-slate-50 ${c.id === currentId ? 'bg-brand-50' : ''}`}>
                <span className="relative shrink-0"><Avatar name={title(c)} size="lg" src={c.other_id ? staffPhotoUrl(c.other_id, c.photo_version ?? null) : null} />{c.kind === 'direct' && c.other_online && <span aria-hidden className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 ring-2 ring-white" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2"><span className={`truncate text-sm text-slate-900 ${c.unread > 0 ? 'font-semibold' : 'font-medium'}`}>{title(c)}</span><span suppressHydrationWarning className={`shrink-0 text-[11px] ${c.unread > 0 ? 'font-semibold text-brand-700' : 'text-slate-500'}`}>{listTime(c.last_at)}</span></span>
                  <span className="mt-0.5 flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs text-slate-500">{c.kind === 'direct' && c.other_online ? <span className="sr-only">Online · </span> : null}{c.muted ? <span className="sr-only">Muted · </span> : null}{c.last_preview || c.org_name}</span>
                    {c.muted && <Icon name="mute" className="h-3.5 w-3.5 text-slate-400" />}
                    {c.unread > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{c.unread}</span>}</span>
                </span>
              </Link></li>))}
            {shown.length === 0 && <li className="p-6 text-center text-sm text-slate-500">No conversations match.</li>}
          </ul>}
      </div>
    </aside>
  )
}
