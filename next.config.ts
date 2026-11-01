import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV !== 'production'

// Content-Security-Policy: pages get a strict, nonce-based policy from src/proxy.ts (no inline scripts);
// API routes that serve files set their own restrictive policy (default-src 'none', sandbox).
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // camera only for the ERP itself (photo capture); never for embedded third parties. Microphone stays blocked.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['@node-rs/argon2', 'postgres'],
  experimental: {
    serverActions: { bodySizeLimit: '11mb' },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
