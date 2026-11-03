import { NextResponse } from 'next/server'
import { getActiveSession } from '@/server/auth/session'
import { openFile } from '@/server/services/documents'

/**
 * Open a document file. The server checks the user's permission in the
 * database (which also audits the attempt) and then redirects to a signed URL
 * that expires in 60 seconds. Unauthorized requests get a plain 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveSession()
  if (!ctx) return new NextResponse('Not found', { status: 404 })
  const { id } = await params
  const url = await openFile(ctx, id).catch(() => null)
  if (!url) return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return new NextResponse(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}
