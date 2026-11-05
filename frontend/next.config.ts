import path from 'node:path'
import { loadEnvConfig, updateInitialEnv } from '@next/env'
import type { NextConfig } from 'next'

// The repository root holds .env (shared with the backend scripts) and the backend sources (../backend), which the app
// imports through the @/server and @/lib aliases (tsconfig.json).
const ROOT = path.resolve(import.meta.dirname, '..')
// Next.js has already loaded env files from frontend/ (there are none) before reading this file, and caches the result,
// so the root files are loaded with forceReload. Variables set in the shell still take precedence over the files, as
// before. updateInitialEnv keeps them when the development server later reloads env files.
const { parsedEnv } = loadEnvConfig(ROOT, process.env.NODE_ENV !== 'production', console, true)
if (parsedEnv) updateInitialEnv(parsedEnv)

const isDev = process.env.NODE_ENV !== 'production'

// Content-Security-Policy: pages get a strict, nonce-based policy from src/proxy.ts (no inline scripts);
// API routes that serve files set their own restrictive policy (default-src 'none', sandbox).
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // camera only for the ERP itself (photo capture); never for embedded third parties. Microphone stays blocked.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: ROOT },
  outputFileTracingRoot: ROOT,
  serverExternalPackages: ['@node-rs/argon2', 'postgres'],
  experimental: {
    serverActions: { bodySizeLimit: '11mb' },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
