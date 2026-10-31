import { dbErrorMessage } from './db'

export type ErrorKind = 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'unknown'

/** An error whose message is safe to show to the user. */
export class ServiceError extends Error {
  constructor(public kind: ErrorKind, message: string, public fieldErrors?: Record<string, string[]>) {
    super(message)
  }
}

export const forbidden = (msg = 'You do not have permission to do that.') => new ServiceError('forbidden', msg)
export const notFound = (msg = 'The record was not found or you do not have access to it.') => new ServiceError('not_found', msg)
export const invalid = (msg: string, fieldErrors?: Record<string, string[]>) => new ServiceError('invalid', msg, fieldErrors)

/** Convert any thrown error into a ServiceError without leaking internals. */
export function toServiceError(e: unknown): ServiceError {
  if (e instanceof ServiceError) return e
  const mapped = dbErrorMessage(e)
  if (mapped.kind === 'unknown') {
    // Log server-side only (never sent to the browser)
    console.error(JSON.stringify({ level: 'error', msg: 'unexpected error', error: e instanceof Error ? { name: e.name, message: e.message, code: (e as { code?: string }).code } : String(e) }))
  }
  return new ServiceError(mapped.kind, mapped.message)
}
