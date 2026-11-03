import { proxyToApi } from '@/server-api/proxy'

/**
 * DEVELOPMENT file server for the local storage driver: proxied to the internal API (GET /api/storage/local), which
 * serves a file only for a valid, unexpired HMAC-signed link issued by /api/files/[id] (disabled when STORAGE_DRIVER is
 * not "local"). The signed query string is passed on unchanged.
 */
export async function GET(req: Request) {
  return proxyToApi(req, '/api/storage/local')
}
