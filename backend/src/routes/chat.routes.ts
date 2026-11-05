import { Router } from 'express'
import { chatSync } from '../services/chat'
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
  return r
}
