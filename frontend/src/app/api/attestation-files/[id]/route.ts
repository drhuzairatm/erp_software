import { NextResponse } from 'next/server'
import { getActiveSession } from '@/lib/auth/session'
import { attestationFileContent } from '@/services/attestation'

/** Supporting documents of attestation stages (documents.file.view; every access audited). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveSession()
  if (!ctx) return new NextResponse('Not found', { status: 404 })
  const { id } = await params
  const f = await attestationFileContent(ctx, id).catch(() => null)
  if (!f) return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return new NextResponse(new Uint8Array(f.data), {
    headers: { 'Content-Type': f.mime, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox" },
  })
}
