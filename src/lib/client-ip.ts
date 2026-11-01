import { isIP } from 'node:net'

/**
 * Client address resolution with an EXPLICIT trusted-proxy setting (audit finding M-1).
 *
 * Forwarding headers can be typed by anyone. A header is only believed when the deployment says which proxy sets it,
 * and that proxy overwrites whatever the client sent. TRUST_PROXY:
 *
 *   none (default)  – no forwarding header is trusted. The address is UNKNOWN (null): per-address limits are skipped,
 *                     per-email / per-identifier limits still apply, and audit records store no address.
 *   x-real-ip       – Hostinger VPS (recommended): Nginx/Caddy sets X-Real-IP to the TCP peer address, replacing any
 *                     incoming value (see docs/DEPLOYMENT.md). Only that header is read.
 *   xff-last        – a single own reverse proxy that APPENDS the peer address to X-Forwarded-For: the right-most entry
 *                     is used (TRUSTED_PROXY_HOPS=n uses the n-th entry from the right, for n trusted proxies).
 *   vercel          – Vercel sets X-Real-IP to the client address and overwrites client-supplied forwarding headers
 *                     (REQUIRES EXTERNAL VALIDATION on the real deployment).
 *
 * Any value that is not a syntactically valid IPv4/IPv6 address is discarded (never stored or rate-limited on).
 */
export type TrustProxyMode = 'none' | 'x-real-ip' | 'xff-last' | 'vercel'

export function trustProxyMode(value = process.env.TRUST_PROXY): TrustProxyMode {
  const v = (value ?? '').trim().toLowerCase()
  if (v === 'x-real-ip' || v === 'xff-last' || v === 'vercel') return v
  return 'none'
}

const valid = (v: string | null | undefined) => {
  const s = (v ?? '').trim()
  return s && s.length <= 64 && isIP(s) !== 0 ? s : null
}

export function resolveClientIp(h: Pick<Headers, 'get'>, mode: TrustProxyMode = trustProxyMode(), hops = Number(process.env.TRUSTED_PROXY_HOPS) || 1): string | null {
  switch (mode) {
    case 'x-real-ip':
    case 'vercel':
      return valid(h.get('x-real-ip'))
    case 'xff-last': {
      const parts = (h.get('x-forwarded-for') ?? '').split(',').map((p) => p.trim()).filter(Boolean)
      const n = Math.min(Math.max(Math.trunc(hops), 1), 10)
      return parts.length >= n ? valid(parts[parts.length - n]) : null
    }
    default:
      return null
  }
}
