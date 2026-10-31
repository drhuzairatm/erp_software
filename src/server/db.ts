import postgres from 'postgres'

/**
 * Database access.
 *
 * The app connects as the low-privilege `erp_app` role. All user-facing data
 * access goes through `withUser()`, which opens a transaction and sets the
 * authenticated user id for row-level security. Without that setting, policies
 * return no rows.
 */
export type Sql = postgres.Sql<Record<string, never>>
export type Tx = postgres.TransactionSql<Record<string, never>>

// Business dates ("today", "overdue") are evaluated in this timezone.
const TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata'

const globalForDb = globalThis as unknown as { __erpSql?: Sql }

function createClient(): Sql {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not configured')
  const pooled = process.env.DATABASE_POOLED === 'true'
  return postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: !pooled, // transaction poolers don't support prepared statements
    onnotice: () => {},
    transform: { undefined: null },
    types: {
      // keep DATE columns as 'YYYY-MM-DD' strings (no timezone shifting)
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      // numeric → string (exact money values); format/convert in the UI
    },
  }) as unknown as Sql
}

export function db(): Sql {
  globalForDb.__erpSql ??= createClient()
  return globalForDb.__erpSql
}

export interface RequestMeta {
  ip?: string | null
}

/** Run `fn` in a transaction as the given user (RLS applies). */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, meta: RequestMeta = {}): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true), set_config('app.request_ip', ${meta.ip ?? ''}, true),
                     set_config('TimeZone', ${TIMEZONE}, true)`
    return fn(tx as unknown as Tx)
  }) as Promise<T>
}

/** Run `fn` in a transaction with NO user (only auth functions are usable). */
export async function anonymous<T>(fn: (tx: Tx) => Promise<T>, meta: RequestMeta = {}): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select set_config('app.request_ip', ${meta.ip ?? ''}, true), set_config('TimeZone', ${TIMEZONE}, true)`
    return fn(tx as unknown as Tx)
  }) as Promise<T>
}

/** Map Postgres errors raised by our functions/policies to safe messages. */
export function dbErrorMessage(e: unknown): { kind: 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'unknown'; message: string } {
  const err = e as { code?: string; message?: string; constraint_name?: string }
  switch (err?.code) {
    case '42501':
      return { kind: 'forbidden', message: 'You do not have permission to do that.' }
    case 'P0002':
      return { kind: 'not_found', message: 'The record was not found or you do not have access to it.' }
    case '23514':
    case '22P02':
    case '22007':
    case '22008':
      // Our own check messages are written for users; constraint names are not.
      return { kind: 'invalid', message: err.message && !err.message.includes('violates check constraint') ? capitalise(err.message) : 'Some values are not valid.' }
    case '23505':
      return { kind: 'conflict', message: 'A record with these details already exists.' }
    case '23503':
      return { kind: 'invalid', message: 'A referenced record does not exist.' }
    default:
      return { kind: 'unknown', message: 'Something went wrong. Please try again.' }
  }
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).trim().replace(/\s+$/, '') + (/[.!?]$/.test(s.trim()) ? '' : '.')
}
