import { NextResponse } from 'next/server'
import { ALLOWED_MIME, readLocal, verifyLocalSignature } from '@/server/storage'

/**
 * DEVELOPMENT file server for the local storage driver. Serves a file only for
 * a valid, unexpired HMAC-signed link issued by /api/files/[id]. Disabled when
 * STORAGE_DRIVER is not "local".
 */
export async function GET(req: Request) {
  if ((process.env.STORAGE_DRIVER || 'local') !== 'local') return new NextResponse('Not found', { status: 404 })
  const q = new URL(req.url).searchParams
  const key = q.get('k') ?? ''
  const exp = Number(q.get('e'))
  const filename = q.get('f') ?? 'document'
  const type = q.get('t') ?? ''
  const sig = q.get('s') ?? ''
  if (!(ALLOWED_MIME as readonly string[]).includes(type) || !verifyLocalSignature(key, exp, filename, type, sig)) {
    return new NextResponse('Link expired or invalid', { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const data = await readLocal(key)
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': type,
        'Content-Disposition': `inline; filename="${filename.replace(/[^\w.\- ()]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
