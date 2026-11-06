import { Router } from 'express'
import { getPassiveSession } from '@/lib/auth/session'
import { chatSync } from '../services/chat'
import { chatNotificationState } from '../services/chat-notifications'
import { authenticate, sessionOf } from '../middleware/authenticate'
import { ServiceError } from '../lib/errors'
import { sendNotFound } from '../lib/send'

/** What the chat page asks for every few seconds. Same path as the browser-facing Next.js route that proxies to it. */
export function chatRouter() {
  const r = Router()
  r.get('/api/chat/sync', authenticate(), async (req, res) => {
    const q = req.query as Record<string, string | undefined>
    const data = await chatSync(sessionOf(res), { conversationId: q.c, read: q.read === '1', typing: q.typing === '1', before: q.before }).catch((e: unknown) => {
      if (e instanceof ServiceError) return null // not a member: answered like a record that does not exist
      throw e // anything else reaches the error handler and is logged
    })
    if (!data) return sendNotFound(res, true)
    res.setHeader('Cache-Control', 'no-store')
    res.json(data)
  })
  // The shared notification poller on every staff page. It reads only, and does not count as activity for the idle limit.
  // Signed out is a normal answer here, so a page left open after sign-out stays quiet.
  r.get('/api/chat/notifications', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const ctx = await getPassiveSession()
    res.json(ctx ? await chatNotificationState(ctx, { onChatPage: req.query.chat === '1' }) : { signedIn: false })
  })
  return r
}
