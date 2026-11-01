import { type NextRequest, NextResponse } from 'next/server'

/**
 * Strict Content-Security-Policy with a fresh nonce per page request (Phase B).
 * Scripts run only if they carry this request's nonce (or are loaded by such a script: 'strict-dynamic');
 * injected inline scripts are blocked. 'unsafe-inline' is NOT allowed for scripts.
 * Styles keep 'unsafe-inline' because React renders style attributes (crop/zoom positions); this does not allow script execution.
 * 'wasm-unsafe-eval' only lets the in-app PDF viewer run its bundled WebAssembly decoders. 'unsafe-eval' only in development (React debugging).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const dev = process.env.NODE_ENV !== 'production'
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    "font-src 'self' data:",
    "connect-src 'self'" + (dev ? ' ws: wss:' : ''),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|brands|pdfjs).*)' }],
}
