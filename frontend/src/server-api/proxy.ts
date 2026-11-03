import 'server-only'
import { ApiUnavailableError, forwardToApi } from './forward'

/** Response headers passed back to the browser unchanged; everything else from the API is dropped. Set-Cookie: all values. */
export const RELAYED_RESPONSE_HEADERS = [
  'content-type', 'content-disposition', 'content-length', 'cache-control', 'location',
  'x-content-type-options', 'content-security-policy', 'referrer-policy',
] as const

export interface ProxyOptions {
  /** Pass the browser's Authorization header on (cron routes only). */
  forwardAuthorization?: boolean
  /** Response when the API cannot be reached or is not configured. Default: 502, empty, no-store. */
  unavailable?: () => Response
}

/**
 * Explicit proxy for a route handler: forwards this request to `apiPath` on the internal API (same query string), with
 * the allow-listed headers and the signed credential (forward.ts), and relays status, allow-listed headers, every
 * Set-Cookie and the body stream. Redirects from the API are passed to the browser, never followed here.
 */
export async function proxyToApi(req: Request, apiPath: string, opts: ProxyOptions = {}): Promise<Response> {
  const method = req.method.toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  try {
    const upstream = await forwardToApi({
      method,
      path: apiPath + new URL(req.url).search,
      incoming: req.headers,
      body: hasBody ? new Uint8Array(await req.arrayBuffer()) : undefined,
      contentType: hasBody ? (req.headers.get('content-type') ?? undefined) : undefined,
      authorization: opts.forwardAuthorization ? (req.headers.get('authorization') ?? undefined) : undefined,
    })
    const headers = new Headers()
    for (const n of RELAYED_RESPONSE_HEADERS) { const v = upstream.headers.get(n); if (v !== null) headers.set(n, v) }
    for (const c of upstream.headers.getSetCookie()) headers.append('set-cookie', c)
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (e) {
    if (!(e instanceof ApiUnavailableError)) throw e
    return opts.unavailable?.() ?? new Response(null, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
