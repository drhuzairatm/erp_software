import { NextResponse } from 'next/server'
import { getActiveSession } from '@/server/auth/session'
import { fileContent } from '@/server/services/documents'

/**
 * File bytes for the in-app viewer. Requires documents.file.view; every access
 * (granted or denied) is written to the audit log by the database.
 * Served same-origin so the viewer needs no third-party access.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveSession()
  if (!ctx) return new NextResponse('Not found', { status: 404 })
  const { id } = await params
  const f = await fileContent(ctx, id).catch(() => null)
  if (!f) return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return new NextResponse(new Uint8Array(f.data), {
    headers: {
      'Content-Type': f.mime,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
