import 'server-only'
import { QUARANTINE_MESSAGE, scanAndRecord } from '../lib/security/file-scan'
import { createHmac, randomBytes, randomInt } from 'node:crypto'
import { requestClientIp, requestCookies as cookies, requestHeaders as headers } from '../lib/http/request-context'
import { anonymous } from '../lib/db'
import { checkPasswordStrength, getDummyHash, hashPassword, verifyPassword } from '../lib/auth/password'
import { encryptAuthSecret } from '../lib/auth/auth-message-crypto'
import { encryptSecret } from '../lib/auth/mfa'
import { hashToken, newTokenValue } from '../lib/auth/tokens'
import { deviceHash, newDeviceToken, PORTAL_DEVICE_COOKIE, readDeviceToken, setDeviceCookie } from '../lib/auth/trusted-device'
import { appUrl } from '../lib/email'
import { invalid, ServiceError } from '../lib/errors'
import { getStorage, MAX_UPLOAD_BYTES, newStorageKey, safeFilename, sha256, sniffMime } from '../lib/storage'

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
  return { ip: await requestClientIp(), ua: h.get('user-agent') ?? '' }
}

/** Ask for a sign-in code. Always returns a challenge id (never reveals whether the identifier exists). */
export async function requestCode(identifier: string) {
  const id = identifier.trim().slice(0, 200)
  const isEmail = id.includes('@')
  if (isEmail ? !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(id) : id.replace(/\D/g, '').length < 7) {
    throw invalid('Enter the email address or mobile number you gave us.')
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  // the code goes to the secure authentication queue ENCRYPTED (finding N-8); only its HMAC is kept for checking
  const { ip } = await ipAndAgent()
  const [{ id: challenge }] = await anonymous((tx) => tx<{ id: string }[]>`
    select app.portal_request_code(${id}, ${encryptAuthSecret('portal_login_code', code)}, ${hmac(code)}, ${ip}) as id`)
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
  documents: { id: string; name: string; required: boolean; state: string; reason: string | null; can_upload: boolean
    attestation: { state: 'processing' | 'completed'; done: number; total: number } | null }[]
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
  const scan = await scanAndRecord(key, buf)
  if (scan?.status === 'infected') throw invalid(QUARANTINE_MESSAGE)
}

// ---------------------------------------------------------------- originals by courier
export interface PortalShipment {
  id: string; status: string; issued_at: string; address: string; instructions: string | null; courier_company: string | null
  tracking_number: string | null; dispatch_date: string | null; received_at: string | null; documents: string[]
}

/** Courier instructions exist only after staff approved the scans and issued them. */
export async function portalShipments(th: string): Promise<PortalShipment[]> {
  const [r] = await anonymous((tx) => tx<{ s: PortalShipment[] }[]>`select app.portal_shipments(${th}) as s`)
  return r?.s ?? []
}

export async function portalSubmitCourier(shipmentId: string, company: string, tracking: string, dispatchDate: string | null) {
  const th = await tokenHash()
  if (!th) throw new ServiceError('forbidden', 'Your session has ended. Please sign in again.')
  if (!/^[0-9a-f-]{36}$/i.test(shipmentId)) throw new ServiceError('invalid', 'Unknown shipment.')
  const c = company.trim(); const t = tracking.trim()
  if (!c || !t) throw new ServiceError('invalid', 'Enter the courier company and the tracking number.', {
    ...(c ? {} : { courierCompany: ['Required.'] }), ...(t ? {} : { trackingNumber: ['Required.'] }) })
  const d = dispatchDate && /^\d{4}-\d{2}-\d{2}$/.test(dispatchDate) ? dispatchDate : null
  await anonymous((tx) => tx`select app.portal_submit_courier(${th}, ${shipmentId}, ${c}, ${t}, ${d})`)
}

// ---------------------------------------------------------------- password login (portal v2)
/**
 * Student ID or verified email + password. Same answer for unknown, wrong or locked (no enumeration).
 * Finding N-1: each attempt is RESERVED in the database before the password is checked (no parallel guessing beyond the
 * limit). Unrecognised browsers: 5 failures per account, then 15 minutes; a browser that signed in successfully before
 * (trusted, cookie hash only) has its own limit of 10, so knowing a Student ID is not enough to lock the student out.
 */
export async function passwordLogin(identifier: string, password: string) {
  const id = identifier.trim().slice(0, 200)
  if (!id || !password || password.length > 200) return false
  const jar = await cookies()
  const device = deviceHash(readDeviceToken(jar, PORTAL_DEVICE_COOKIE))
  const candidates = await anonymous((tx) => tx<{ account_id: string; password_hash: string | null; trusted: boolean }[]>`
    select * from app.portal_password_begin(${id}, ${device})`)
  const ok: string[] = []; const failed: string[] = []
  if (!candidates.length) await verifyPassword(await getDummyHash(), password) // equal timing
  for (const c of candidates) {
    if (!c.password_hash) { failed.push(c.account_id); continue }
    if (await verifyPassword(c.password_hash, password)) ok.push(c.account_id); else failed.push(c.account_id)
  }
  const token = randomBytes(32).toString('base64url')
  const fresh = newDeviceToken()
  const { ip, ua } = await ipAndAgent()
  const [r] = await anonymous((tx) => tx<{ ok: boolean; device_added: boolean }[]>`
    select * from app.portal_password_finish(${id}, ${ok}::uuid[], ${failed}::uuid[], ${device}, ${hmac(token)}, ${ip}, ${ua}, ${fresh.hash})`)
  if (r.ok) {
    jar.set(PORTAL_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/portal', maxAge: 4 * 3600,
    })
    if (r.device_added) setDeviceCookie(jar, PORTAL_DEVICE_COOKIE, fresh.token, '/portal')
  }
  return r.ok
}

/** Set-up / reset link: returns the Student ID to show, or null if the link is not valid. */
export async function checkPasswordLink(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null
  const [r] = await anonymous((tx) => tx<{ code: string | null }[]>`select app.portal_link_check(${hashToken(token)}) as code`)
  return r?.code ?? null
}

/** Set or reset the portal password with a link. With `deviceTokenHash`, the browser that did it becomes trusted (recovery). */
export async function setPasswordWithLink(token: string, password: string, confirm: string, deviceTokenHash: string | null = null) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw invalid('This link is not valid. Ask us for a new one.')
  if (password !== confirm) throw invalid('The two passwords are different.', { confirm: ['Does not match.'] })
  const weak = checkPasswordStrength(password)
  if (weak) throw invalid(weak, { password: [weak] })
  const [r] = await anonymous(async (tx) => tx<{ code: string | null }[]>`
    select app.portal_set_password_trusted(${hashToken(token)}, ${await hashPassword(password)}, ${deviceTokenHash}) as code`)
  if (!r?.code) throw invalid('This link has expired or was already used. Ask us for a new one, or use "Forgot password".')
  return r.code
}

export async function requestPasswordReset(identifier: string) {
  const id = identifier.trim().slice(0, 200)
  if (id.length < 3) throw invalid('Enter your Student ID or verified email address.')
  const token = newTokenValue()
  // the link is queued ENCRYPTED in the secure portal email queue (finding N-7)
  await anonymous((tx) => tx`select app.portal_request_reset(${id}, ${hashToken(token)}, ${encryptSecret(appUrl(`/portal/password?token=${token}`))})`)
}

// ---------------------------------------------------------------- notices, publications, payments
export interface PortalNotice { id: string; kind: string; title: string; body: string | null; created_at: string; read: boolean }
export async function portalNotices(th: string): Promise<PortalNotice[]> {
  const [r] = await anonymous((tx) => tx<{ n: PortalNotice[] }[]>`select app.portal_notices(${th}) as n`)
  return r?.n ?? []
}
export async function markNoticesRead() {
  const th = await tokenHash()
  if (th) await anonymous((tx) => tx`select app.portal_mark_notices_read(${th})`)
}

export interface PortalPublication { id: string; title: string; published_at: string; mime: string }
export async function portalPublications(th: string): Promise<PortalPublication[]> {
  const [r] = await anonymous((tx) => tx<{ p: PortalPublication[] }[]>`select app.portal_publications(${th}) as p`)
  return r?.p ?? []
}

/** Bytes of a published file for the signed-in student (logged and audited in the database). */
export async function portalDownload(publicationId: string) {
  const th = await tokenHash()
  if (!th || !/^[0-9a-f-]{36}$/i.test(publicationId)) return null
  const { ip } = await ipAndAgent()
  const [f] = await anonymous((tx) => tx<{ storage_key: string; mime_type: string; original_filename: string }[]>`
    select * from app.portal_download(${th}, ${publicationId}, ${ip})`)
  if (!f) return null
  return { data: await (await getStorage()).get(f.storage_key), mime: f.mime_type, filename: f.original_filename }
}

export interface PortalPayments {
  entries: { date: string; type: string; category: string; amount: string; currency: string; status: string; reference: string | null }[]
  balances: { currency: string; due: string; received: string; outstanding: string; pending: string }[]
}
export async function portalPayments(th: string): Promise<PortalPayments | null> {
  const [r] = await anonymous((tx) => tx<{ p: PortalPayments | null }[]>`select app.portal_payments(${th}) as p`)
  return r?.p ?? null
}

// ---------------------------------------------------------------- Refer a Friend
const REFERRAL_FIELDS = ['name', 'phone', 'whatsapp', 'email', 'residenceCountryId', 'destinationCountryId', 'programme', 'qualification', 'preferredCompany', 'remarks'] as const
function referralPayload(fd: FormData) {
  const p: Record<string, string | boolean> = {}
  for (const k of REFERRAL_FIELDS) { const v = String(fd.get(k) ?? '').trim(); if (v) p[k] = v.slice(0, k === 'remarks' ? 2000 : 200) }
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p.email))) throw invalid('Enter a valid email address.', { email: ['Invalid.'] })
  p.consent = fd.get('consent') === 'yes'
  return p
}
function referralError(e: unknown): never {
  const m = (e as { message?: string }).message ?? ''
  const known = ['consent', 'name', 'programme', 'refer yourself', 'too many', 'not valid']
  if (known.some((k) => m.includes(k))) throw invalid(m.charAt(0).toUpperCase() + m.slice(1) + '.')
  throw e
}

export async function portalReferralCode(th: string) {
  const [r] = await anonymous((tx) => tx<{ code: string | null }[]>`select app.portal_referral_code(${th}) as code`)
  return r?.code ?? null
}
export async function portalReferrals(th: string): Promise<{ name: string; created_at: string; status: string }[]> {
  const [r] = await anonymous((tx) => tx<{ r: { name: string; created_at: string; status: string }[] }[]>`select app.portal_referrals(${th}) as r`)
  return r?.r ?? []
}
export async function portalSubmitReferral(fd: FormData) {
  const th = await tokenHash()
  if (!th) throw new ServiceError('forbidden', 'Your session has ended. Please sign in again.')
  const p = referralPayload(fd)
  const { ip } = await ipAndAgent()
  await anonymous((tx) => tx`select app.portal_submit_referral(${th}, ${tx.json(p)}, ${ip})`).catch(referralError)
}
export async function publicReferralInfo(code: string) {
  if (!/^[A-Za-z2-9]{10}$/.test(code)) return null
  const [r] = await anonymous((tx) => tx<{ i: { first_name: string; company: string } | null }[]>`select app.public_referral_info(${code}) as i`)
  return r?.i ?? null
}
export async function publicSubmitReferral(code: string, fd: FormData) {
  if (!/^[A-Za-z2-9]{10}$/.test(code)) throw invalid('This referral link is not valid.')
  const p = referralPayload(fd)
  const { ip } = await ipAndAgent()
  await anonymous((tx) => tx`select app.public_submit_referral(${code}, ${tx.json(p)}, ${ip})`).catch(referralError)
}
export async function referralCountries() {
  return anonymous((tx) => tx<{ id: string; name: string; is_destination: boolean }[]>`select * from app.public_countries()`)
}
