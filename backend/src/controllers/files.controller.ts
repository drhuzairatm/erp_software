import type { Request, Response } from 'express'
import { fileContent, openFile } from '@/services/documents'
import { localSignedFile } from '@/services/files'
import { paramOf, queryOf, sendExact, sendNotFound, sendRedirectNoStore, TEXT_PLAIN } from '../lib/send'
import { sessionOf } from '../middleware/authenticate'

/**
 * HTTP side of the read-only document-file routes. Input parsing and responses only; every rule stays in the services
 * (and the database functions they call). Responses are byte-for-byte the former Next.js route handlers' (recorded in
 * frontend/tests/integration/contract-files-photos.test.ts). The session gate (404 without a cache header when not signed
 * in) runs before these handlers: middleware/authenticate.ts.
 *   signed in but not allowed / unknown / malformed id / any service error: 404 "Not found" with no-store
 */
const VIEWER_HEADERS = { 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }

/** GET /api/files/:id — 302 to a 60-second signed link (documents.download; audited by the database). */
export async function openFileHandler(req: Request, res: Response) {
  const url = await openFile(sessionOf(res), paramOf(req, 'id')).catch(() => null)
  if (!url) return sendNotFound(res, true)
  sendRedirectNoStore(res, url)
}

/** GET /api/files/:id/content — bytes for the in-app viewer (documents.file.view; audited by the database). */
export async function fileContentHandler(req: Request, res: Response) {
  const f = await fileContent(sessionOf(res), paramOf(req, 'id')).catch(() => null)
  if (!f) return sendNotFound(res, true)
  sendExact(res, 200, { 'Content-Type': f.mime, ...VIEWER_HEADERS }, new Uint8Array(f.data))
}

/** GET /api/storage/local?k&e&f&t&s — the local storage driver's signed-link file server (no session). */
export async function localFileHandler(req: Request, res: Response) {
  const q = queryOf(req)
  const link = { key: q.get('k') ?? '', exp: Number(q.get('e')), filename: q.get('f') ?? 'document', type: q.get('t') ?? '', sig: q.get('s') ?? '' }
  const r = await localSignedFile(link)
  if (r.kind === 'disabled' || r.kind === 'missing') return sendNotFound(res, false)
  if (r.kind === 'invalid') return sendExact(res, 403, { 'Content-Type': TEXT_PLAIN, 'Cache-Control': 'no-store' }, 'Link expired or invalid')
  sendExact(res, 200, {
    'Content-Type': link.type,
    'Content-Disposition': `inline; filename="${link.filename.replace(/[^\w.\- ()]/g, '_')}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Referrer-Policy': 'no-referrer',
  }, new Uint8Array(r.data))
}
