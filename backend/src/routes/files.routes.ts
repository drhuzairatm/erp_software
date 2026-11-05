import { Router } from 'express'
import { fileContentHandler, localFileHandler, openFileHandler, openSecureFileHandler } from '../controllers/files.controller'
import { authenticate } from '../middleware/authenticate'

/** Read-only document-file routes. Same paths as the browser-facing Next.js routes that proxy to them. */
export function filesRouter() {
  const r = Router()
  r.get('/api/files/:id', authenticate(), openFileHandler)
  r.get('/api/files/:id/content', authenticate(), fileContentHandler)
  r.get('/api/secure-files/:id', authenticate(), openSecureFileHandler)
  r.get('/api/storage/local', localFileHandler) // signed link: the signature is the authorization, no session
  return r
}
