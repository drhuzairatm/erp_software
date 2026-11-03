/** Phase 6: student portal password accounts, publication with logged downloads, portal notices, optional payment view. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous, db } from '@/server/db'
import { ServiceError } from '@/server/errors'
import { encryptSecret } from '@/server/auth/mfa'
import { verifyPassword } from '@/server/auth/password'
import { hashToken } from '@/server/auth/tokens'
import { checkPasswordLink, setPasswordWithLink } from '@/server/portal'
import * as documents from '@/server/services/documents'
import * as pa from '@/server/services/portal-accounts'
import * as students from '@/server/services/students'
import { adminSql, as, ctxFor, orgId, securityClear } from '../support/helpers'

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const pdf = () => new File([Buffer.from('%PDF-1.4\n% fictional\n')], 'd.pdf', { type: 'application/pdf' })
const PASSWORD = 'Fictional-Pass-2026!'
beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}
async function newStudent() {
  const mgr = await ctxFor('edx.manager@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Portal Student', phone: `+91 90092 ${rand()}`, email: `p6.${rand()}@example.test` })
  if (!r.ok) throw new Error('duplicate')
  const [s] = await adminSql()`select student_code, email from students where id = ${r.id}`
  return { mgr, id: r.id, code: s.student_code as string, email: s.email as string }
}
/** Same steps as the sign-in page (password check in the application, outcome in the database). */
async function login(identifier: string, password: string) {
  const cands = await anonymous((tx) => tx<{ account_id: string; password_hash: string | null }[]>`select * from app.portal_password_candidates(${identifier})`)
  const ok: string[] = []; const failed: string[] = []
  for (const c of cands) (c.password_hash && await verifyPassword(c.password_hash, password) ? ok : failed).push(c.account_id)
  const token = `t-${rand()}-${Date.now()}`
  const [r] = await anonymous((tx) => tx<{ ok: boolean }[]>`select app.portal_password_result(${identifier}, ${ok}::uuid[], ${failed}::uuid[], ${token}, '127.0.0.1', 'test') as ok`)
  return r.ok ? token : null
}
const linkToken = (link: string) => new URL(link).searchParams.get('token')!

describe('password accounts', () => {
  it('staff create the account; the link sets a password once; login by Student ID (email only once verified)', async () => {
    const s = await newStudent()
    const r = await pa.issuePortalLink(s.mgr, s.id)
    expect(r.mode).toBe('link') // email not verified → handed over personally, nothing e-mailed
    const token = linkToken(r.link!)
    expect(await checkPasswordLink(token)).toBe(s.code)
    await expectServiceError(setPasswordWithLink(token, 'short', 'short'), 'invalid')
    await expectServiceError(setPasswordWithLink(token, PASSWORD, PASSWORD + 'x'), 'invalid')
    expect(await setPasswordWithLink(token, PASSWORD, PASSWORD)).toBe(s.code)
    await expectServiceError(setPasswordWithLink(token, PASSWORD, PASSWORD), 'invalid') // single use
    expect(await login(s.code, PASSWORD)).toBeTruthy()
    expect(await login(s.code.toLowerCase(), PASSWORD)).toBeTruthy()
    expect(await login(s.email, PASSWORD)).toBeNull() // email not verified
    expect((await pa.portalAccount(s.mgr, s.id)).account).toMatchObject({ status: 'active' })
    // the stored hash is argon2id, never the password; links are not readable by the app role
    const [acc] = await adminSql()`select password_hash from auth_private.student_accounts where student_id = ${s.id}`
    expect(acc.password_hash).toMatch(/^\$argon2id\$/)
    await expect(db()`select * from auth_private.student_account_tokens limit 1`).rejects.toThrow()
  })

  it('five wrong passwords lock the account for 15 minutes; disabling signs the student out', async () => {
    const s = await newStudent()
    const t = linkToken((await pa.issuePortalLink(s.mgr, s.id)).link!)
    await setPasswordWithLink(t, PASSWORD, PASSWORD)
    const session = await login(s.code, PASSWORD)
    for (let i = 0; i < 5; i++) expect(await login(s.code, 'Wrong-Password-123!')).toBeNull()
    expect(await login(s.code, PASSWORD)).toBeNull() // locked even with the right password
    expect((await pa.portalAccount(s.mgr, s.id)).account?.locked).toBe(true)
    await adminSql()`update auth_private.student_accounts set locked_until = now() - interval '1 second' where student_id = ${s.id}`
    expect(await login(s.code, PASSWORD)).toBeTruthy()
    await expectServiceError(pa.setPortalAccountEnabled(s.mgr, s.id, false, ''), 'invalid')
    await pa.setPortalAccountEnabled(s.mgr, s.id, false, 'Left the programme (test)')
    expect(await login(s.code, PASSWORD)).toBeNull()
    const [{ sid }] = await anonymous((tx) => tx<{ sid: string | null }[]>`select app.portal_student(${session!}) as sid`)
    expect(sid).toBeNull()
  })

  it('only staff with portal.accounts.manage on the student can issue links', async () => {
    const s = await newStudent()
    await expectServiceError(pa.issuePortalLink(await ctxFor('grd.counsellor@demo.test'), s.id))
    await expectServiceError(pa.issuePortalLink(await ctxFor('edx.finance@demo.test'), s.id))
    expect((await pa.issuePortalLink(await ctxFor('edx.counsellor@demo.test'), s.id)).mode).toBe('link')
  })

  it('forgot password e-mails a reset link only to a verified address; links never stay readable', async () => {
    const s = await newStudent()
    const t = linkToken((await pa.issuePortalLink(s.mgr, s.id)).link!)
    await setPasswordWithLink(t, PASSWORD, PASSWORD)
    const link = encryptSecret('http://x/portal/password?token=abc') // the database accepts only encrypted links (N-7)
    await anonymous((tx) => tx`select app.portal_request_reset(${s.code}, ${hashToken('unverified-' + rand())}, ${link})`)
    expect(await adminSql()`select 1 from auth_private.portal_email_outbox where student_id = ${s.id}`).toHaveLength(0)
    await adminSql().begin(async (tx) => { await tx`select set_config('app.email_verify', 'on', true)`; await tx`update students set email_status = 'verified', email_verified_at = now() where id = ${s.id}` })
    await anonymous((tx) => tx`select app.portal_request_reset(${s.email}, ${hashToken('verified-' + rand())}, ${link})`)
    // N-7: queued in the secure (encrypted) portal email queue, never in the staff-visible outbox
    expect(await adminSql()`select 1 from auth_private.portal_email_outbox where student_id = ${s.id} and kind = 'portal_password_reset'`).toHaveLength(1)
    expect(await adminSql()`select 1 from notification_messages where student_id = ${s.id} and event_key = 'portal_password_reset'`).toHaveLength(0)
    // neither a counsellor nor a manager (outbox permission) can read the queue
    await expect(as('edx.counsellor@demo.test', (tx) => tx`select 1 from auth_private.portal_email_outbox`)).rejects.toThrow()
    await expect(as('edx.manager@demo.test', (tx) => tx`select 1 from auth_private.portal_email_outbox`)).rejects.toThrow()
    // verified email now works for sign-in
    expect(await login(s.email, PASSWORD)).toBeTruthy()
  })
})

describe('publication, notices and payments', () => {
  it('only approved documents are published; downloads are the student\'s own, logged, and stop after withdrawal', async () => {
    const s = await newStudent()
    const docs = await ctxFor('docs@demo.test')
    await students.setAssignment(s.mgr, s.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
    const item = (await documents.getChecklist(s.mgr, s.id)).items.find((i) => i.type_key === 'plus_two_certificate')!
    await documents.uploadDocument(docs, item.id, pdf())
    await expectServiceError(pa.publishDocument(s.mgr, item.id)) // not approved
    for (const q of (await documents.getDocumentReview(docs, item.id))!.requirements.filter((x) => x.is_mandatory)) await documents.recordVerification(docs, item.id, q.id, 'present')
    await documents.documentAction(docs, item.id, 'verify'); await documents.documentAction(docs, item.id, 'submit'); await securityClear(item.id); await documents.documentAction(s.mgr, item.id, 'approve')
    await expectServiceError(pa.publishDocument(await ctxFor('edx.counsellor@demo.test'), item.id)) // no documents.publish
    const pub = await pa.publishDocument(s.mgr, item.id, 'Plus Two (approved copy)')
    const token = `t-${rand()}`
    await adminSql()`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${token}, ${[s.id]}, ${s.id})`
    const [{ p }] = await anonymous((tx) => tx<{ p: { id: string; title: string }[] }[]>`select app.portal_publications(${token}) as p`)
    expect(p.map((x) => x.title)).toEqual(['Plus Two (approved copy)'])
    expect(await anonymous((tx) => tx`select * from app.portal_download(${token}, ${pub}, '127.0.0.1')`)).toHaveLength(1)
    // another student's session gets nothing (and the attempt is audited)
    const other = await newStudent(); const otherToken = `t-${rand()}`
    await adminSql()`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${otherToken}, ${[other.id]}, ${other.id})`
    expect(await anonymous((tx) => tx`select * from app.portal_download(${otherToken}, ${pub}, '127.0.0.1')`)).toHaveLength(0)
    expect((await pa.studentPublications(s.mgr, s.id)).rows[0].downloads).toBe(1)
    await expectServiceError(pa.unpublishDocument(s.mgr, pub, ''), 'invalid')
    await pa.unpublishDocument(s.mgr, pub, 'Replaced (test)')
    expect(await anonymous((tx) => tx`select * from app.portal_download(${token}, ${pub}, '127.0.0.1')`)).toHaveLength(0)
    // portal notices: approval and publication
    const [{ n }] = await anonymous((tx) => tx<{ n: { title: string; read: boolean }[] }[]>`select app.portal_notices(${token}) as n`)
    expect(n.map((x) => x.title)).toEqual(expect.arrayContaining(['Plus Two Certificate approved', 'New document available: Plus Two (approved copy)']))
    await anonymous((tx) => tx`select app.portal_mark_notices_read(${token})`)
    const [{ n: after }] = await anonymous((tx) => tx<{ n: { read: boolean }[] }[]>`select app.portal_notices(${token}) as n`)
    expect(after.every((x) => x.read)).toBe(true)
  })

  it('payments are hidden unless the company switches them on; then only the student\'s own', async () => {
    const s = await newStudent()
    const token = `t-${rand()}`
    await adminSql()`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${token}, ${[s.id]}, ${s.id})`
    await adminSql()`update organizations set settings = settings - 'portal_show_payments' where id = ${EDX}`
    expect((await anonymous((tx) => tx<{ p: unknown }[]>`select app.portal_payments(${token}) as p`))[0].p).toBeNull()
    try {
      await adminSql()`update organizations set settings = settings || '{"portal_show_payments": true}' where id = ${EDX}`
      const [{ p }] = await anonymous((tx) => tx<{ p: { entries: unknown[]; balances: unknown[] } }[]>`select app.portal_payments(${token}) as p`)
      expect(p).toMatchObject({ entries: [], balances: [] })
    } finally {
      await adminSql()`update organizations set settings = settings - 'portal_show_payments' where id = ${EDX}`
    }
  })
})

