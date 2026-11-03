import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { resolveClientIp } from '@/lib/client-ip'
import type { CookieJar, RequestContextProvider } from '@/lib/http/request-context'

/**
 * Next.js request-context provider: what shared server code (backend/src/server) used directly before the Express
 * refactor — next/headers, next/navigation and the client address from the trusted proxy header (TRUST_PROXY).
 * Selected for the Next.js app by the `@/lib/http/context-provider` alias (frontend/tsconfig.json).
 */
export const provider: RequestContextProvider = {
  headers: () => headers(),
  cookies: async () => (await cookies()) as unknown as CookieJar,
  clientIp: async () => resolveClientIp(await headers()),
  redirect: (url: string): never => redirect(url),
}
