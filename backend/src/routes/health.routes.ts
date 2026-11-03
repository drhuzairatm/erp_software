import { Router } from 'express'
import { db } from '@/lib/db'
import { sendJson } from '../lib/send'

/** Liveness/readiness check. Same contract as the former Next.js route: reveals no data. */
export function healthRouter() {
  const r = Router()
  r.get('/api/health', async (_req, res) => {
    try {
      await db()`select 1`
      sendJson(res, 200, { status: 'ok' }, { 'Cache-Control': 'no-store' })
    } catch {
      sendJson(res, 503, { status: 'database_unavailable' }, { 'Cache-Control': 'no-store' })
    }
  })
  return r
}
