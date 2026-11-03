import { apiPathSegment } from '@/server-api/forward'
import { proxyToApi } from '@/server-api/proxy'

/**
 * Download the passport photo through a 60-second signed URL: proxied to the internal API
 * (GET /api/students/:id/photo/download). Audited.
 * The query string is passed on unchanged; the id is sent as one encoded path segment (apiPathSegment).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyToApi(req, `/api/students/${apiPathSegment(id)}/photo/download`)
}
