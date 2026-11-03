import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../../../../backend/src/app'

/**
 * Starts the real Express API in this test process on a random loopback port and points the Next.js side at it
 * (API_INTERNAL_URL). Uses the test-only INTERNAL_API_SECRET from backend/tests/support/test-env.ts.
 */
export async function startTestApi() {
  const logs: Record<string, unknown>[] = []
  const { app, replay } = createApp({ secret: process.env.INTERNAL_API_SECRET!, log: (e) => logs.push(e) })
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const previous = process.env.API_INTERNAL_URL
  process.env.API_INTERNAL_URL = base
  const close = () => new Promise<void>((resolve) => {
    if (previous === undefined) delete process.env.API_INTERNAL_URL; else process.env.API_INTERNAL_URL = previous
    replay.stop(); server.closeAllConnections(); server.close(() => resolve())
  })
  return { base, logs, close }
}
