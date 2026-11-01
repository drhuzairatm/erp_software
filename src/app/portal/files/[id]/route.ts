import { NextResponse } from 'next/server'
import { portalDownload } from '@/server/portal'

/** A document published to the signed-in student. Every download is logged; anything else is a plain 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const f = await portalDownload(id).catch(() => null)
  if (!f) return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  const name = f.filename.replace(/[^\w.\- ]+/g, '_')
  return new NextResponse(new Uint8Array(f.data), {
    headers: {
      'Content-Type': f.mime,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
