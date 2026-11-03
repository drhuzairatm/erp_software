import { apiPathSegment } from '@/server-api/forward'
import { proxyToApi } from '@/server-api/proxy'

/**
 * Staff photo (thumbnail, or ?size=display) for signed-in colleagues who share a company: proxied to the internal API
 * (GET /api/staff/:id/photo). Never public; plain 404 otherwise.
 * The query string is passed on unchanged; the id is sent as one encoded path segment (apiPathSegment).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyToApi(req, `/api/staff/${apiPathSegment(id)}/photo`)
}
