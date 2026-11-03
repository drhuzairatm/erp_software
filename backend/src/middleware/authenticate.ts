import type { RequestHandler, Response } from 'express'
import type { AuthContext } from '@/lib/auth/context'
import { getActiveSession } from '@/lib/auth/session'
import { sendNotFound } from '../lib/send'

/**
 * The staff-session gate of the browser-facing GET routes, moved unchanged out of their handlers: a fully set-up staff
 * session (getActiveSession: signed in, no pending two-step code, no required password change or MFA set-up) or a plain
 * 404 "Not found" WITHOUT a cache header, before anything else is looked at. Permissions are not decided here: they stay
 * in the services and the database functions (company isolation, documents.file.view, audit).
 */
export function authenticate(): RequestHandler {
  return async (_req, res, next) => {
    const ctx = await getActiveSession()
    if (!ctx) return sendNotFound(res, false)
    res.locals.session = ctx
    next()
  }
}

/** The session set by authenticate() for this request. */
export const sessionOf = (res: Response) => res.locals.session as AuthContext
