import type { Metadata, Viewport } from 'next'
import { connection } from 'next/server'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Staff Portal – Dr.Expert Edulinks & GRADUATER', template: '%s · Staff Portal' },
  description: 'Internal operations system',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // every page is rendered per request so the CSP nonce (src/proxy.ts) can be applied to Next.js scripts
  await connection()
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
