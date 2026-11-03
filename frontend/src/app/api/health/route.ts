import { proxyToApi } from '@/server-api/proxy'

/**
 * Liveness/readiness check for uptime monitoring. Reveals no data. Answered by the internal API (database check) through
 * this server: 200 {"status":"ok"} or 503 {"status":"database_unavailable"}. If the API cannot be reached or is not
 * configured: 503 {"status":"api_unavailable"}.
 */
export async function GET(req: Request) {
  return proxyToApi(req, '/api/health', {
    unavailable: () => Response.json({ status: 'api_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }),
  })
}
