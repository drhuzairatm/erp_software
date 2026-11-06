/** The browser-free rules of chat notifications: what counts as new, and what a notification may say. */

export const CHAT_STATE_EVENT = 'erp:chat-state'
export const CHAT_READ_EVENT = 'erp:chat-read'
const SEEN_LIMIT = 300

export interface AlertSettings { inApp: boolean; sound: boolean; desktopPreview: boolean }
export interface UnreadConversation {
  id: string; kind: string; title: string | null; orgName: string; unread: number; muted: boolean
  latest: { id: string; at: string; sender: string; preview: string }
}
export interface ChatState { total: number; sig: string; settings: AlertSettings; conversations: UnreadConversation[] }
export interface NotifyMemory { baseline: string | null; seen: string[] }

/**
 * Decides which conversations need a new alert. Stored per browser and person, so navigation, refresh, reconnecting or another
 * tab never repeat one. The first ever run only sets a baseline: older unread messages show in the badge, not as a burst of alerts.
 * Sorted server times are compared as text; only the server's clock is used.
 */
export function pickNew(conversations: UnreadConversation[], serverTime: string, memory: NotifyMemory, currentConversation: string | null) {
  if (!memory.baseline) return { fresh: [] as UnreadConversation[], memory: { baseline: serverTime, seen: remember(memory.seen, conversations.map((c) => c.latest.id)) } }
  const seen = new Set(memory.seen)
  const fresh = conversations.filter((c) => !seen.has(c.latest.id) && !c.muted && c.id !== currentConversation && c.latest.at >= memory.baseline!)
  return { fresh, memory: { baseline: memory.baseline, seen: remember(memory.seen, conversations.map((c) => c.latest.id)) } }
}

function remember(seen: string[], ids: string[]) {
  return [...new Set([...seen, ...ids])].slice(-SEEN_LIMIT)
}

export const conversationHref = (id: string) => `/chat?c=${encodeURIComponent(id)}`

/** "Asha" for a direct message; "Asha in Sales" for a group; the company as well for someone in several companies. */
export function alertTitle(c: UnreadConversation, showCompany: boolean) {
  const where = c.kind === 'group' && c.title ? `${c.latest.sender} in ${c.title}` : c.latest.sender
  return showCompany ? `${where} (${c.orgName})` : where
}

/** On screen inside the ERP: the message preview. */
export function toastBody(c: UnreadConversation) {
  return c.unread > 1 ? `${c.unread} new messages. Latest: ${c.latest.preview}` : c.latest.preview
}

/** Outside the ERP the text can show on a lock screen, so the words appear only if the person chose that. */
export function desktopBody(c: UnreadConversation, showPreview: boolean) {
  if (showPreview) return toastBody(c)
  return c.unread > 1 ? `${c.unread} new messages` : 'New message'
}

export const badgeText = (n: number) => (n > 99 ? '99+' : String(n))

/** Next poll: faster while someone is looking, and backing off while the connection is down. */
export function nextDelay(visible: boolean, failures: number) {
  if (failures > 0) return Math.min(60_000, 5_000 * 2 ** (failures - 1))
  return visible ? 5_000 : 15_000
}
