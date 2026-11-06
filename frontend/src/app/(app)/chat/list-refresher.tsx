'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { CHAT_STATE_EVENT } from '@/components/chat-notify-logic'

/** Keeps the conversation list and unread counts current from the shared poller: reloads the server-rendered list only when something changed. */
export function ChatListRefresher() {
  const router = useRouter()
  const last = useRef<string | null>(null)
  useEffect(() => {
    const onState = (e: Event) => {
      const { sig } = (e as CustomEvent<{ sig: string }>).detail
      if (last.current !== null && sig !== last.current) router.refresh()
      last.current = sig
    }
    window.addEventListener(CHAT_STATE_EVENT, onState)
    return () => window.removeEventListener(CHAT_STATE_EVENT, onState)
  }, [router])
  return null
}
