import type { Request, Response } from 'express'
import { requestStore } from './http/context-provider'

/**
 * Sends a response exactly as given: status, these headers, this body. Express adds nothing (no charset rewriting, no
 * ETag, no X-Powered-By). Cookies set during the request (request store) are sent as separate Set-Cookie headers.
 */
export function sendExact(res: Response, status: number, headers: Record<string, string>, body?: string | Buffer | Uint8Array) {
  const cookies = requestStore.getStore()?.setCookies ?? []
  res.status(status)
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  if (cookies.length) res.setHeader('Set-Cookie', cookies)
  res.end(body ?? undefined)
}

export function sendJson(res: Response, status: number, value: unknown, headers: Record<string, string> = {}) {
  sendExact(res, status, { 'Content-Type': 'application/json', ...headers }, JSON.stringify(value))
}

/** Content-Type of the plain-text bodies the former Next.js route handlers sent (`new NextResponse('…')`). */
export const TEXT_PLAIN = 'text/plain;charset=UTF-8'

/** 404 "Not found" as the former route handlers sent it: no cache header when signed out, no-store otherwise. */
export function sendNotFound(res: Response, noStore: boolean) {
  sendExact(res, 404, { 'Content-Type': TEXT_PLAIN, ...(noStore ? { 'Cache-Control': 'no-store' } : {}) }, 'Not found')
}

/** 302 to a short-lived signed link, never cached, no Referer sent on. */
export function sendRedirectNoStore(res: Response, location: string) {
  sendExact(res, 302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
}

/** Query values exactly as the former handlers read them (URLSearchParams: first value of a repeated key). */
export const queryOf = (req: Request) => new URL(req.originalUrl, 'http://internal').searchParams
export const paramOf = (req: Request, name: string) => String(req.params[name])
