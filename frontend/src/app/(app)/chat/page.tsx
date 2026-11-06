import type { Metadata } from 'next'
import Link from 'next/link'
import { openDirectAction } from '@/app/actions/chat'
import { fmtDateTime } from '@/components/format'
import { Avatar, Badge, Card, EmptyState, PageHeader, staffPhotoUrl } from '@/components/ui'
import { can } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { governanceAccess } from '@/services/chat-governance'
import { chatPeople, chatTaskOptions, GROUP_TYPES, listConversations, REACTIONS, searchChat } from '@/services/chat'
import { ChatListRefresher } from './list-refresher'
import { ChatRoom } from './chat-room'
import { NewGroupForm } from './group-form'

export const metadata: Metadata = { title: 'Chat' }

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const [conversations, people, governance] = await Promise.all([listConversations(ctx), chatPeople(ctx), governanceAccess(ctx)])
  const current = conversations.find((c) => c.id === sp.c) ?? null
  const groupOrgs = ctx.memberships.filter((m) => can(ctx, 'chat.groups.manage', m.orgId)).map((m) => ({ id: m.orgId, name: m.orgName }))
  const results = sp.q ? await searchChat(ctx, sp.q) : []
  const tasks = current ? await chatTaskOptions(ctx, current.org_id) : []
  const title = (c: (typeof conversations)[number]) => c.name ?? c.other_name ?? 'Conversation'
  return (
    <>
      <div className={current ? 'hidden lg:block' : ''}><PageHeader title="Chat" description="Private to the people in each conversation. Updates arrive every few seconds." actions={governance.length ? <Link className="btn-secondary" href="/chat/governance">Governance</Link> : undefined} /></div>
      <ChatListRefresher />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className={`space-y-4 ${current ? 'hidden lg:block' : ''}`}>
          <Card title="Start a conversation">
            <form action={openDirectAction} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1"><label className="label" htmlFor="chat-person">Direct message</label>
                <select className="input" id="chat-person" name="person" required defaultValue=""><option value="" disabled>Choose a person…</option>{people.map((p) => <option key={`${p.org_id}${p.id}`} value={`${p.org_id}|${p.id}`}>{p.full_name} ({p.org_name})</option>)}</select></div>
              <button className="btn-primary btn-sm">Open</button>
            </form>
            {groupOrgs.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">New group</summary><div className="mt-2"><NewGroupForm orgs={groupOrgs} people={people} types={GROUP_TYPES.map(([value, label]) => ({ value, label }))} /></div></details>}
          </Card>
          <Card padded={false}>
            <form className="flex gap-2 border-b border-slate-100 p-3"><label className="sr-only" htmlFor="chat-q">Search messages</label><input className="input" id="chat-q" name="q" placeholder="Search your messages" defaultValue={sp.q} /><button className="btn-secondary btn-sm">Search</button></form>
            {sp.q && <ul className="divide-y divide-slate-100 border-b border-slate-100 text-sm">{results.length === 0 ? <li className="p-3 text-slate-500">No messages found.</li> : results.map((r) => <li key={r.id}><Link className="block p-3 no-underline hover:bg-slate-50" href={`/chat?c=${r.conversation_id}`}><span className="block wrap-anywhere">{r.body}</span><span className="text-xs text-slate-500">{r.sender_name} · {fmtDateTime(r.created_at)}</span></Link></li>)}</ul>}
            {conversations.length === 0 ? <div className="p-4"><EmptyState title="No conversations yet" /></div> : <ul className="divide-y divide-slate-100" data-testid="conversation-list">{conversations.map((c) => (
              <li key={c.id}><Link href={`/chat?c=${c.id}`} className={`flex items-center gap-3 p-3 no-underline hover:bg-slate-50 ${c.id === current?.id ? 'bg-brand-50' : ''}`}>
                <Avatar name={title(c)} size="sm" src={c.other_id ? staffPhotoUrl(c.other_id, c.photo_version) : null} />
                <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 text-sm font-medium text-slate-900"><span className="truncate">{title(c)}</span>{c.unread > 0 && <Badge tone="red">{c.unread}</Badge>}</span>
                  <span className="block truncate text-xs text-slate-500">{c.kind === 'direct' && c.other_online ? 'Online · ' : ''}{c.muted ? 'Muted · ' : ''}{c.last_preview || c.org_name}</span></span>
              </Link></li>))}</ul>}
          </Card>
        </div>
        <div className="min-w-0">
          {current ? <ChatRoom key={current.id} muted={current.muted} conversationId={current.id} title={title(current)} kind={current.kind} groupType={current.group_type} isAdmin={current.role === 'admin'} me={ctx.userId}
            orgPeople={people.filter((p) => p.org_id === current.org_id).map((p) => ({ id: p.id, full_name: p.full_name }))} reactions={[...REACTIONS]} others={conversations.filter((c) => c.org_id === current.org_id && c.id !== current.id).map((c) => ({ id: c.id, title: title(c) }))} tasks={tasks} />
            : <div className="card p-8 text-center text-sm text-slate-500">Choose a conversation.</div>}
        </div>
      </div>
    </>
  )
}
