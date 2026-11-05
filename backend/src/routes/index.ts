import { Router } from 'express'
import { chatRouter } from './chat.routes'
import { filesRouter } from './files.routes'
import { healthRouter } from './health.routes'
import { photosRouter } from './photos.routes'
import { studentsRouter } from './students.routes'

/** Every API route, mounted by app.ts after the internal gate and the per-request context. */
export function apiRoutes() {
  const r = Router()
  r.use(healthRouter())
  r.use(chatRouter())
  r.use(filesRouter())
  r.use(photosRouter())
  r.use(studentsRouter())
  return r
}
