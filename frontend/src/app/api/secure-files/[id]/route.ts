import { apiPathSegment } from '@/server-api/forward'
import { proxyToApi } from '@/server-api/proxy'

/**
 * Open a secure file (for example a task attachment): proxied to the internal API (GET /api/secure-files/:id), which checks
 * access in the database (audited) and answers with a 302 to a signed URL that expires in 60 seconds. Otherwise a plain 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyToApi(req, `/api/secure-files/${apiPathSegment(id)}`)
}
