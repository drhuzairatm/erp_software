import type { Request, Response } from 'express'
import { importTemplateCsv } from '@/services/student-import'
import { sendExact } from '../lib/send'

/**
 * HTTP side of the students module's existing endpoint. Byte-for-byte the former Next.js route handler's response
 * (recorded in frontend/tests/integration/contract-students.test.ts). The session gate runs first
 * (middleware/authenticate.ts); there is no permission check beyond a fully set-up staff session, as before.
 */

/** GET /api/students/import-template — the CSV template for the student import (UTF-8 with BOM, for Excel). */
export function importTemplateHandler(_req: Request, res: Response) {
  sendExact(res, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="student-import-template.csv"',
    'Cache-Control': 'no-store',
  }, importTemplateCsv())
}
