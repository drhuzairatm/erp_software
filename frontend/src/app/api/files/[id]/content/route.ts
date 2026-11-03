import { apiPathSegment } from '@/server-api/forward'
import { proxyToApi } from '@/server-api/proxy'

/**
 * File bytes for the in-app viewer: proxied to the internal API (GET /api/files/:id/content). Requires
 * documents.file.view; every access (granted or denied) is written to the audit log by the database.
 * The query string is passed on unchanged; the id is sent as one encoded path segment (apiPathSegment).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyToApi(req, `/api/files/${apiPathSegment(id)}/content`)
}
