import { proxyToApi } from '@/server-api/proxy'

/** The shared chat notification poll, proxied to the internal API, which checks the session and reads as this person only. */
export async function GET(req: Request) {
  return proxyToApi(req, '/api/chat/notifications') // the proxy forwards the query string itself
}
