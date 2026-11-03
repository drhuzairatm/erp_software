import { Router } from 'express'
import { staffPhotoHandler, studentPhotoDownloadHandler, studentPhotoHandler } from '../controllers/photos.controller'
import { authenticate } from '../middleware/authenticate'

/** Read-only student and staff photo routes. Same paths as the browser-facing Next.js routes that proxy to them. */
export function photosRouter() {
  const r = Router()
  r.get('/api/students/:id/photo', authenticate(), studentPhotoHandler)
  r.get('/api/students/:id/photo/download', authenticate(), studentPhotoDownloadHandler)
  r.get('/api/staff/:id/photo', authenticate(), staffPhotoHandler)
  return r
}
