import { NextResponse } from 'next/server'
import { getActiveSession } from '@/server/auth/session'
import { staffPhotoBytes } from '@/server/services/staff-photos'

/** Staff photo for signed-in colleagues who share a company. Never public; plain 404 otherwise. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveSession()
  if (!ctx) return new NextResponse('Not found', { status: 404 })
  const { id } = await params
  const size = new URL(req.url).searchParams.get('size') === 'display' ? 'display' : 'thumb'
  const f = await staffPhotoBytes(ctx, id, size).catch(() => null)
  if (!f) return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return new NextResponse(new Uint8Array(f.data), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" },
  })
}
