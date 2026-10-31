import { NextResponse } from 'next/server'
import { getActiveSession } from '@/server/auth/session'
import { importTemplateCsv } from '@/server/services/student-import'

export async function GET() {
  if (!(await getActiveSession())) return new NextResponse('Not found', { status: 404 })
  return new NextResponse(importTemplateCsv(), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="student-import-template.csv"', 'Cache-Control': 'no-store' },
  })
}
