import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV !== 'production'

// Content Security Policy. 'unsafe-inline' for scripts is required by Next.js
// hydration without a nonce setup; everything else is locked to our own origin.
const csp = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the in-app PDF viewer use its bundled image decoders (served from our own origin)
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // live camera preview (MediaStream) and captured image previews
  "media-src 'self' blob: mediastream:",
  "font-src 'self' data:",
  "connect-src 'self'" + (isDev ? ' ws: wss:' : ''),
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
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
