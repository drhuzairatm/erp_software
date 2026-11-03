import cluster from 'node:cluster'
import type { Server } from 'node:http'
import { assertNotificationConfig } from '@/lib/config/notifications-config'
import { db } from '@/lib/db'
import { loadEnv } from '../scripts/lib/env'
import { createApp } from './app'
import { apiConfig } from './lib/api-config'

/**
 * Starts the API: loads the repository .env (real environment variables win), validates the settings (apiConfig), applies
 * the same notification safety check as the Next.js server (production refuses an unsafe notification mode), and
 * listens on the loopback address. A second instance on the same port fails with EADDRINUSE.
 */
export async function start(): Promise<Server> {
  loadEnv()
  const cfg = apiConfig(process.env, cluster.isWorker)
  assertNotificationConfig()
  const { app, replay } = createApp({ secret: cfg.secret })
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(cfg.port, cfg.host, () => resolve(s))
    s.once('error', reject)
  })
  console.log(JSON.stringify({ level: 'info', msg: 'API listening', host: cfg.host, port: cfg.port }))
  const stop = () => {
    replay.stop()
    server.close(() => { void db().end({ timeout: 5 }).finally(() => process.exit(0)) })
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  return server
}

// Entry point of the API process (npm run dev:api / npm run start:api); formerly src/api/server.ts.
start().catch((e: unknown) => {
  console.error(JSON.stringify({ level: 'error', msg: 'API failed to start', error: e instanceof Error ? e.message : String(e) }))
  process.exit(1)
})
