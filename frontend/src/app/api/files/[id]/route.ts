import { apiPathSegment } from '@/server-api/forward'
import { proxyToApi } from '@/server-api/proxy'

/**
 * Open a document file: proxied to the internal API (GET /api/files/:id), which checks the user's permission in the
 * database (audited) and answers with a 302 to a signed URL that expires in 60 seconds. Unauthorized requests get a
 * plain 404.
 * The query string is passed on unchanged; the id is sent as one encoded path segment (apiPathSegment).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyToApi(req, `/api/files/${apiPathSegment(id)}`)
}
