import postgres from 'postgres'
import { withUser, type Tx } from '@/server/db'

let admin: postgres.Sql | null = null
export function adminSql() {
  admin ??= postgres(process.env.DATABASE_ADMIN_URL!, { max: 2, onnotice: () => {} })
  return admin
}

const idCache = new Map<string, string>()
export async function userId(email: string) {
  if (!idCache.has(email)) {
    const [u] = await adminSql()<{ id: string }[]>`select id from user_profiles where email = ${email}`
    if (!u) throw new Error(`no such demo user ${email}`)
    idCache.set(email, u.id)
  }
  return idCache.get(email)!
}

export async function orgId(code: 'EDX' | 'GRD') {
  const [o] = await adminSql()<{ id: string }[]>`select id from organizations where code = ${code}`
  return o.id
}

export async function as<T>(email: string, fn: (tx: Tx) => Promise<T>) {
  return withUser(await userId(email), fn)
}

/** Pick a demo student matching a condition (admin view, bypasses RLS). */
export async function studentWhere(where: string) {
  const rows = await adminSql().unsafe(`select s.id, s.student_code, s.originating_org_id from students s
     join organizations o on o.id = s.originating_org_id where ${where} order by s.student_code limit 1`)
  if (!rows.length) throw new Error(`no student for ${where}`)
  return rows[0] as unknown as { id: string; student_code: string; originating_org_id: string }
}

export async function expectDbError(p: Promise<unknown>, code: string) {
  try {
    await p
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (err.code === code) return err
    throw new Error(`expected error ${code}, got ${err.code}: ${err.message}`)
  }
  throw new Error(`expected error ${code}, but the operation succeeded`)
}

import { loadMemberships } from '@/server/auth/context'
import type { Ctx } from '@/server/services/base'

/** Build the same authorization context the web app builds for a session. */
export async function ctxFor(email: string): Promise<Ctx> {
  const id = await userId(email)
  const memberships = await withUser(id, (tx) => loadMemberships(tx, id))
  return { userId: id, memberships, ip: '127.0.0.1' }
}

/** Simulates the MD delegating master-data permissions to the System Administrator role (MD-only by default since 0031). */
export async function delegateToSystemAdmin(perms: string[]) {
  await adminSql()`insert into role_permissions (role_id, permission_key)
    select r.id, p from roles r cross join unnest(${perms}::text[]) p where r.key = 'system_admin' on conflict do nothing`
}

/**
 * No virus scanner runs in the test environment, so – exactly as in production without a scanner – an authorised
 * person (the demo MD) gives MANUAL security clearance to the current file before it can be approved.
 */
export async function securityClear(documentId: string) {
  await as('md@demo.test', (tx) => tx`select app.clear_file_manually((select current_file_id from student_documents where id = ${documentId}),
    'Fictional test file – manual clearance (no scanner in tests)')`)
}
