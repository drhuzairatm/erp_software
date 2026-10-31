import { NextResponse } from 'next/server'
import { db } from '@/server/db'

/** Liveness/readiness check for uptime monitoring. Reveals no data. */
export async function GET() {
  try {
    await db()`select 1`
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ status: 'database_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
