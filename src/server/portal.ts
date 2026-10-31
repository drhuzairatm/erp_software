import 'server-only'
import { createHmac, randomBytes, randomInt } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { anonymous } from './db'
import { invalid } from './errors'
import { getStorage, MAX_UPLOAD_BYTES, newStorageKey, safeFilename, sha256, sniffMime } from './storage'

/**
 * Student portal authentication and data access. Students never get a staff
 * session; every query goes through app.portal_* functions keyed by the
 * session token, which return only the signed-in student's own data.
 */
export const PORTAL_COOKIE = process.env.NODE_ENV === 'production' ? '__Secure-erp_portal' : 'erp_portal'

function secret() {
  const s = process.env.PORTAL_SECRET || process.env.STORAGE_SIGNING_SECRET
  if (!s || s.length < 32) throw new Error('PORTAL_SECRET (or STORAGE_SIGNING_SECRET) must be set')
  return s
}
const hmac = (v: string) => createHmac('sha256', secret()).update(v).digest('hex')

async function ipAndAgent() {
  const h = await headers()
  const fwd = h.get('x-forwarded-for')
  return { ip: (fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip')) || null, ua: h.get('user-agent') ?? '' }
}

/** Ask for a sign-in code. Always returns a challenge id (never reveals whether the identifier exists). */
export async function requestCode(identifier: string) {
  const id = identifier.trim().slice(0, 200)
  const isEmail = id.includes('@')
  if (isEmail ? !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(id) : id.replace(/\D/g, '').length < 7) {
    throw invalid('Enter the email address or mobile number you gave us.')
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const { ip } = await ipAndAgent()
  const [{ id: challenge }] = await anonymous((tx) => tx<{ id: string }[]>`
    select app.portal_request_code(${id}, ${code}, ${hmac(code)}, ${ip}) as id`)
  return challenge
}

export async function verifyCode(challenge: string, code: string) {
  if (!/^[0-9a-f-]{36}$/i.test(challenge)) return { ok: false, locked: true }
  const clean = code.replace(/\D/g, '')
  if (clean.length !== 6) return { ok: false, locked: false }
  const token = randomBytes(32).toString('base64url')
  const { ip, ua } = await ipAndAgent()
  const [r] = await anonymous((tx) => tx<{ ok: boolean; locked: boolean }[]>`
    select * from app.portal_verify_code(${challenge}, ${hmac(clean)}, ${hmac(token)}, ${ip}, ${ua})`)
  if (r.ok) {
    ;(await cookies()).set(PORTAL_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/portal', maxAge: 4 * 3600,
    })
  }
  return r
}

async function tokenHash() {
  const t = (await cookies()).get(PORTAL_COOKIE)?.value
  return t && t.length <= 100 ? hmac(t) : null
}

export async function portalSession() {
  const th = await tokenHash()
  if (!th) return null
  const [s] = await anonymous((tx) => tx<{ student_ids: string[]; active_student_id: string | null }[]>`select * from app.portal_session(${th})`)
  return s ? { ...s, tokenHash: th } : null
}

export async function portalChoices(th: string) {
  return anonymous((tx) => tx<{ student_id: string; student_code: string; company: string }[]>`select * from app.portal_choices(${th})`)
}

export async function chooseStudent(studentId: string) {
  const th = await tokenHash()
  if (!th || !/^[0-9a-f-]{36}$/i.test(studentId)) return false
  const [r] = await anonymous((tx) => tx<{ ok: boolean | null }[]>`select app.portal_choose(${th}, ${studentId}) as ok`)
  return !!r.ok
}

export async function portalLogout() {
  const th = await tokenHash()
  if (th) await anonymous((tx) => tx`select app.portal_logout(${th})`)
  ;(await cookies()).delete({ name: PORTAL_COOKIE, path: '/portal' })
}

export interface PortalOverview {
  student: { code: string; name: string; status: string; stage: string; next_action: string | null; next_action_due: string | null
    destination: string | null; course: string | null; university: string | null; counsellor: string | null }
  company: { code: string; name: string; support_phone: string | null; support_email: string | null }
  stages: { name: string; state: 'done' | 'current' | 'upcoming' }[]
  documents: { id: string; name: string; required: boolean; state: string; reason: string | null; can_upload: boolean }[]
}

export async function portalOverview(th: string): Promise<PortalOverview | null> {
  const [r] = await anonymous((tx) => tx<{ o: PortalOverview | null }[]>`select app.portal_overview(${th}) as o`)
  return r.o
}

/** Student uploads a requested document (same file checks as staff uploads; never approved automatically). */
export async function portalUpload(documentId: string, file: File) {
  const th = await tokenHash()
  if (!th) throw invalid('Your session has ended. Please sign in again.')
  if (!(file instanceof File) || file.size === 0) throw invalid('Choose a file.')
  if (file.size > MAX_UPLOAD_BYTES) throw invalid('The file is larger than 10 MB.')
  const buf = Buffer.from(await file.arrayBuffer())
  const mime = sniffMime(buf)
  if (!mime) throw invalid('Please upload a PDF, JPEG, PNG or WebP file.')
  const [target] = await anonymous((tx) => tx<{ student_id: string; org_id: string }[]>`select * from app.portal_upload_target(${th}, ${documentId})`)
  if (!target) throw invalid('This document cannot be uploaded at the moment.')
  const storage = await getStorage()
  const key = newStorageKey(target.org_id, target.student_id)
  await storage.put(key, buf, mime)
  try {
    await anonymous((tx) => tx`select app.portal_register_document_file(${th}, ${documentId}, ${key}, ${safeFilename(file.name)}, ${mime}, ${buf.length}, ${sha256(buf)})`)
  } catch (e) {
    await storage.remove(key).catch(() => {})
    throw e
  }
}
