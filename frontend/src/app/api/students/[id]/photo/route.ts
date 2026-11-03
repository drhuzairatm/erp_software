import { apiPathSegment } from '@/server-api/forward'
import { proxyToApi } from '@/server-api/proxy'

/**
 * Student photo (thumbnail, or ?size=portrait) for signed-in staff who can see the student: proxied to the internal
 * API (GET /api/students/:id/photo). Never public; plain 404 otherwise.
 * The query string is passed on unchanged; the id is sent as one encoded path segment (apiPathSegment).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyToApi(req, `/api/students/${apiPathSegment(id)}/photo`)
}
