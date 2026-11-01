import { NextResponse } from 'next/server'
import { getActiveSession } from '@/server/auth/session'
import { studentPhotoDownloadUrl } from '@/server/services/photos'

/** Download the passport photo (portrait, full quality) through a 60-second signed URL. Audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveSession()
  if (!ctx) return new NextResponse('Not found', { status: 404 })
  const { id } = await params
  const url = await studentPhotoDownloadUrl(ctx, id).catch(() => null)
  if (!url) return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return new NextResponse(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}
