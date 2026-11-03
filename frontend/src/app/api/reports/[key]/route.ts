import { NextResponse } from 'next/server'
import { getActiveSession } from '@/lib/auth/session'
import { ServiceError } from '@/lib/errors'
import { getScope } from '@/services/scope'
import { exportReport } from '@/services/reports'

/** CSV export. Permission-checked and written to the audit log. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await getActiveSession()
  if (!ctx) return new NextResponse('Not found', { status: 404 })
  const { key } = await params
  const scope = await getScope(ctx)
  const q = Object.fromEntries(new URL(req.url).searchParams.entries())
  try {
    const { filename, csv } = await exportReport(ctx, key, scope.orgIds, q)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    const status = e instanceof ServiceError && e.kind === 'forbidden' ? 403 : 404
    return new NextResponse(e instanceof ServiceError ? e.message : 'Not found', { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
