'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/** Keeps the conversation list and unread counts current: reloads the server-rendered list only when something changed. */
export function ChatListRefresher() {
  const router = useRouter()
  const last = useRef<string | null>(null)
  useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch('/api/chat/sync', { cache: 'no-store' })
        if (!res.ok) return
        const { conversations } = await res.json() as { conversations: { id: string; unread: number; last_at: string | null }[] }
        const sig = conversations.map((c) => `${c.id}:${c.unread}:${c.last_at}`).sort().join('|')
        if (last.current !== null && sig !== last.current) router.refresh()
        last.current = sig
      } catch { /* the conversation view shows the connection notice */ }
    }
    void tick()
    const t = setInterval(() => { void tick() }, 5000)
    return () => clearInterval(t)
  }, [router])
  return null
}
