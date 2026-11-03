import type { Request, Response } from 'express'
import { studentPhotoBytes, studentPhotoDownloadUrl } from '@/services/photos'
import { staffPhotoBytes } from '@/services/staff-photos'
import { paramOf, queryOf, sendExact, sendNotFound, sendRedirectNoStore } from '../lib/send'
import { sessionOf } from '../middleware/authenticate'

/**
 * HTTP side of the read-only student and staff photo routes. Input parsing and responses only; the rules stay in the
 * services and database functions. Responses are byte-for-byte the former Next.js route handlers' (recorded in
 * frontend/tests/integration/contract-files-photos.test.ts). The session gate runs first (middleware/authenticate.ts).
 *   signed in but not allowed / no photo / unknown / malformed id / any service error: 404 "Not found" with no-store
 */
const IMAGE_HEADERS = { 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }

/** GET /api/students/:id/photo?size=portrait — thumbnail (default) or portrait. */
export async function studentPhotoHandler(req: Request, res: Response) {
  const size = queryOf(req).get('size') === 'portrait' ? 'portrait' : 'thumb'
  const f = await studentPhotoBytes(sessionOf(res), paramOf(req, 'id'), size).catch(() => null)
  if (!f) return sendNotFound(res, true)
  sendExact(res, 200, { 'Content-Type': f.mime, ...IMAGE_HEADERS }, new Uint8Array(f.data))
}

/** GET /api/students/:id/photo/download — 302 to a 60-second signed link (audited by the database). */
export async function studentPhotoDownloadHandler(req: Request, res: Response) {
  const url = await studentPhotoDownloadUrl(sessionOf(res), paramOf(req, 'id')).catch(() => null)
  if (!url) return sendNotFound(res, true)
  sendRedirectNoStore(res, url)
}

/** GET /api/staff/:id/photo?size=display — thumbnail (default) or display version; always JPEG. */
export async function staffPhotoHandler(req: Request, res: Response) {
  const size = queryOf(req).get('size') === 'display' ? 'display' : 'thumb'
  const f = await staffPhotoBytes(sessionOf(res), paramOf(req, 'id'), size).catch(() => null)
  if (!f) return sendNotFound(res, true)
  sendExact(res, 200, { 'Content-Type': 'image/jpeg', ...IMAGE_HEADERS }, new Uint8Array(f.data))
}
