import { provider } from '@/lib/http/context-provider'

/**
 * Request context for shared server code (sign-in, sessions, portal, company scope): request headers, cookies, the
 * client address and "send the browser elsewhere". Server code calls these functions instead of a framework directly,
 * so the same code runs inside the Next.js app and inside the Express API.
 *
 * Which provider is used is decided when the code is built, through the module alias `@/lib/http/context-provider`:
 *   - Next.js app (and tests that simulate it): frontend/src/server-api/next-context-provider.ts — next/headers,
 *     next/navigation, client address from the trusted proxy header (TRUST_PROXY), exactly as before;
 *   - Express API (default, backend tsconfig): ./context-provider.ts — a per-request AsyncLocalStorage store filled
 *     only from the verified internal credential.
 */

export interface CookieOptions {
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'lax' | 'strict' | 'none' | boolean
  path?: string
  domain?: string
  maxAge?: number
  expires?: Date | number
}

/** The cookie operations shared server code uses (same shape as Next.js cookies()). */
export interface CookieJar {
  get(name: string): { name: string; value: string } | undefined
  set(name: string, value: string, options?: CookieOptions): unknown
  delete(name: string | { name: string; path?: string; domain?: string }): unknown
}

export interface RequestHeaders {
  get(name: string): string | null
  has(name: string): boolean
}

export interface RequestContextProvider {
  headers(): Promise<RequestHeaders>
  cookies(): Promise<CookieJar>
  /** Client address: from the trusted proxy header (Next.js) or from the verified internal credential (Express). */
  clientIp(): Promise<string | null>
  /** Send the browser to `url`. Never returns. */
  redirect(url: string): never
}

export const requestHeaders = () => provider.headers()
export const requestCookies = () => provider.cookies()
export const requestClientIp = () => provider.clientIp()
export function redirectTo(url: string): never {
  return provider.redirect(url)
}
