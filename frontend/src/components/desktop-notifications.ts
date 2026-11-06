import { conversationHref } from './chat-notify-logic'

/** Desktop notifications on this device. Permission belongs to the browser, so this choice is stored per browser, off until the person turns it on. */
const key = (userId: string) => `erp.chat.desktop.${userId}`
const SW = '/chat-notifications-sw.js'

export type DesktopStatus = 'unsupported' | 'default' | 'granted' | 'denied'
export const desktopStatus = (): DesktopStatus => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

export function desktopWanted(userId: string) {
  try { return desktopStatus() === 'granted' && localStorage.getItem(key(userId)) === 'on' } catch { return false }
}

/** Call only from a click. Never asks a browser that has already been told no. */
export async function turnOnDesktop(userId: string): Promise<DesktopStatus> {
  if (desktopStatus() === 'unsupported' || desktopStatus() === 'denied') return desktopStatus()
  const answer = desktopStatus() === 'granted' ? 'granted' : await Notification.requestPermission()
  if (answer !== 'granted') return answer
  try { localStorage.setItem(key(userId), 'on') } catch { /* then this browser cannot remember it */ }
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register(SW).catch(() => {})
  return 'granted'
}

export function turnOffDesktop(userId: string) {
  try { localStorage.removeItem(key(userId)) } catch { /* nothing to remove */ }
}

/** One per conversation: the tag replaces an earlier alert for it. Android's browsers allow notifications only through a service worker. */
export async function showDesktopNotification(title: string, body: string, conversationId: string) {
  const url = conversationHref(conversationId); const tag = `erp-chat-${conversationId}`
  try {
    const n = new Notification(title, { body, tag })
    n.onclick = () => { window.focus(); n.close(); location.assign(url) }
  } catch {
    try { await (await navigator.serviceWorker.getRegistration(SW))?.showNotification(title, { body, tag, data: { url } }) } catch { /* the in-app alert and badge still work */ }
  }
}
