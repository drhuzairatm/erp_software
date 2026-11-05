import { proxyToApi } from '@/server-api/proxy'

/** Chat updates, proxied to the internal API, which checks the session and conversation membership. */
export async function GET(req: Request) {
  return proxyToApi(req, '/api/chat/sync') // the proxy forwards the query string itself
}
