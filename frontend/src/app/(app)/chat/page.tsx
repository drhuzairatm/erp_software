import type { Metadata } from 'next'
import { staffPhotoUrl } from '@/components/ui'
import { can } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { governanceAccess } from '@/services/chat-governance'
import { staffPhotoVersions } from '@/services/staff-photos'
import { chatPeople, chatTaskOptions, GROUP_TYPES, listConversations, REACTIONS, searchChat } from '@/services/chat'
import { Icon } from './chat-icons'
import { ChatListRefresher } from './list-refresher'
import { ChatSidebar } from './chat-sidebar'
import { ChatRoom } from './chat-room'
import { NewGroupForm } from './group-form'

export const metadata: Metadata = { title: 'Chat' }

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string; m?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const [conversations, people, governance, photos] = await Promise.all([listConversations(ctx), chatPeople(ctx), governanceAccess(ctx), staffPhotoVersions(ctx, [ctx.userId])])
  const current = conversations.find((c) => c.id === sp.c) ?? null
  const groupOrgs = ctx.memberships.filter((m) => can(ctx, 'chat.groups.manage', m.orgId)).map((m) => ({ id: m.orgId, name: m.orgName }))
  const results = sp.q ? await searchChat(ctx, sp.q) : []
  const tasks = current ? await chatTaskOptions(ctx, current.org_id) : []
  const title = (c: (typeof conversations)[number]) => c.name ?? c.other_name ?? 'Conversation'
  return (
    <div className="-mx-4 -my-6 lg:mx-0 lg:my-0">
      <ChatListRefresher />
      <div className="grid h-[calc(100dvh-3.6rem)] grid-cols-1 overflow-hidden bg-white lg:h-[calc(100dvh-8rem)] lg:grid-cols-[360px_minmax(0,1fr)] lg:rounded-xl lg:border lg:border-slate-200 lg:shadow-sm">
        <ChatSidebar hidden={!!current} meName={ctx.fullName} mePhoto={staffPhotoUrl(ctx.userId, photos[ctx.userId] ?? null)} conversations={conversations} currentId={current?.id ?? null} q={sp.q ?? ''} results={results} people={people} governance={governance.length > 0}
          newGroup={groupOrgs.length > 0 ? <details className="min-w-0 flex-1 basis-full"><summary className="btn-secondary btn-sm w-full cursor-pointer list-none justify-center">New group</summary><div className="mt-2"><NewGroupForm orgs={groupOrgs} people={people} types={GROUP_TYPES.map(([value, label]) => ({ value, label }))} /></div></details> : null} />
        <div className={`min-h-0 min-w-0 ${current ? 'flex' : 'hidden lg:flex'} flex-col`}>
          {current ? <ChatRoom key={current.id} muted={current.muted} conversationId={current.id} title={title(current)} kind={current.kind} groupType={current.group_type} isAdmin={current.role === 'admin'} me={ctx.userId} orgName={current.org_name} initialUnread={current.unread} jump={sp.m ?? null} photo={current.other_id ? staffPhotoUrl(current.other_id, current.photo_version) : null}
            orgPeople={people.filter((p) => p.org_id === current.org_id).map((p) => ({ id: p.id, full_name: p.full_name }))} reactions={[...REACTIONS]} others={conversations.filter((c) => c.org_id === current.org_id && c.id !== current.id).map((c) => ({ id: c.id, title: title(c) }))} tasks={tasks} />
            : <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-slate-50 p-8 text-center text-sm text-slate-500"><Icon name="chat" className="h-10 w-10 text-slate-300" /><p>Choose a conversation.</p><p className="text-xs">Private to the people in each conversation. Updates arrive every few seconds.</p></div>}
        </div>
      </div>
    </div>
  )
}
