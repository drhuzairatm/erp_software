import { proxyToApi } from '@/server-api/proxy'

/** The student-import CSV template for signed-in staff: proxied to the internal API (GET /api/students/import-template). */
export async function GET(req: Request) {
  return proxyToApi(req, '/api/students/import-template')
}
