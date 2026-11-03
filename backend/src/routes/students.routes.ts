import { Router } from 'express'
import { importTemplateHandler } from '../controllers/students.controller'
import { authenticate } from '../middleware/authenticate'

/**
 * The students module's existing HTTP endpoint (same path as the browser-facing Next.js route that proxies to it).
 * The students module's Server Actions and POST /api/students/:id/merge are not on the API yet.
 */
export function studentsRouter() {
  const r = Router()
  r.get('/api/students/import-template', authenticate(), importTemplateHandler)
  return r
}
