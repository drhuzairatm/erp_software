import { NextResponse } from 'next/server'
import { getActiveSession } from '@/server/auth/session'
import { ServiceError } from '@/server/errors'
import { buildMergedPdf } from '@/server/services/merge'

/**
 * Generates the combined PDF and returns it as a download (or inline preview). Nothing is stored.
 * Same-origin form POST only; every source file is authorised and audited in the database.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveSession()
  if (!ctx) return new NextResponse('Not found', { status: 404 })
  const origin = req.headers.get('origin'); const host = req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return new NextResponse('Forbidden', { status: 403 })
  const { id } = await params
  const fd = await req.formData()
  const mode = fd.get('mode') === 'preview' ? 'preview' : 'download'
  try {
    const r = await buildMergedPdf(ctx, id, fd.getAll('files').map(String), {
      universityId: String(fd.get('universityId') ?? '') || null, purpose: String(fd.get('purpose') ?? ''),
      allowUnapproved: fd.get('allowUnapproved') === 'yes', mode,
    })
    if (!r.pdf) {
      const lines = r.check.items.filter((x) => x.error).map((x) => `• ${x.name}: ${x.error}`).join('\n')
      return new NextResponse(`The combined PDF was not generated.\n\n${r.check.error ?? ''}\n${lines}\n\nGo back, correct the selection and try again.`,
        { status: 422, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
    }
    const name = r.check.filename
    const ascii = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'documents.pdf'
    return new NextResponse(new Uint8Array(r.pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${mode === 'preview' ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    const msg = e instanceof ServiceError ? e.message : 'The combined PDF could not be generated.'
    if (!(e instanceof ServiceError)) console.error(JSON.stringify({ level: 'error', msg: 'merge failed', error: String(e) }))
    return new NextResponse(msg, { status: e instanceof ServiceError ? 422 : 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  }
}
