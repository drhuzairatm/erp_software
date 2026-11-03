import express, { type Router } from 'express'
import { errorHandler, notFound } from './middleware/error-handler'
import { internalGate } from './middleware/internal-gate'
import { requestContext } from './middleware/request-context'
import { ReplayCache } from './lib/replay-cache'
import { apiRoutes } from './routes'

export interface AppOptions {
  /** INTERNAL_API_SECRET (validated by apiConfig before this is called). */
  secret: string
  replayMax?: number
  now?: () => number
  log?: (entry: Record<string, unknown>) => void
  /** Tests only: extra routes mounted after the gate and the request context. Production passes nothing. */
  extraRoutes?: (r: Router) => void
}

/**
 * The Express API. Only the Next.js server calls it (internal credential); it is never exposed to browsers.
 * Order: internal gate (credential, one-time nonce, size, body digest) → per-request context → routes → 404 → errors.
 * No CORS headers are ever sent; proxy headers (X-Forwarded-*) are never trusted.
 */
export function createApp(o: AppOptions) {
  const now = o.now ?? Date.now
  const startedAt = now()
  const replay = new ReplayCache(o.replayMax, now)
  replay.startSweeping()

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', false)
  app.set('etag', false)

  app.use(internalGate({ secret: o.secret, replay, notBefore: startedAt, now, log: o.log }))
  app.use(requestContext())
  app.use(apiRoutes())
  if (o.extraRoutes) { const r = express.Router(); o.extraRoutes(r); app.use(r) }
  app.use(notFound)
  app.use(errorHandler(o.log))
  return { app, replay, startedAt }
}
