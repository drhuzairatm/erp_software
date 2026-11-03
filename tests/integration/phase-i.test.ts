/** Phase I: student portal — sign-in codes, own-data-only access, uploads, privacy of codes. */
import { createHmac, randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { decryptAuthSecret, encryptAuthSecret } from '@/server/auth/auth-message-crypto'
import { anonymous, db } from '@/server/db'
import { deliverAuthMessages } from '@/server/notifications/auth-message'
import * as notifications from '@/server/services/notifications'
import * as students from '@/server/services/students'
import { adminSql, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string
const ENV = { ...process.env }
const hmac = (v: string) => createHmac('sha256', process.env.STORAGE_SIGNING_SECRET!).update(v).digest('hex')
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
beforeAll(async () => { EDX = await orgId('EDX') })
afterEach(() => { process.env = { ...ENV } })
afterAll(async () => { await adminSql().end(); await db().end() })

async function newStudent() {
  const mgr = await ctxFor('edx.manager@demo.test')
  const email = `portal.${rand()}${rand()}@example.test`
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Portal Student', phone: `+91 90080 ${rand()}`, email })
  if (!r.ok) throw new Error()
  await students.addNote(mgr, r.id, { orgId: EDX, body: 'INTERNAL NOTE – must never reach the portal' })
  return { mgr, id: r.id, email }
}

async function requestCode(identifier: string, ip = `10.0.${rand().slice(0, 2)}.1`) {
  const code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0')
  // N-8: the database accepts only the encrypted code (as src/server/portal.ts sends it)
  const [{ id }] = await anonymous((tx) => tx<{ id: string }[]>`select app.portal_request_code(${identifier}, ${encryptAuthSecret('portal_login_code', code)}, ${hmac(code)}, ${ip}) as id`)
  return { challenge: id, code }
}
async function verify(challenge: string, code: string) {
  const token = randomBytes(16).toString('hex')
  const [r] = await anonymous((tx) => tx<{ ok: boolean; locked: boolean }[]>`select * from app.portal_verify_code(${challenge}, ${hmac(code)}, ${hmac(token)}, '127.0.0.1', 'test')`)
  return { ...r, th: hmac(token) }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper reads loosely-typed JSON
const overview = async (th: string) => (await anonymous((tx) => tx<{ o: Record<string, any> | null }[]>`select app.portal_overview(${th}) as o`))[0].o

describe('sign-in with a one-time code', () => {
  it('a registered email gets a code message; the right code opens a session for that student only', async () => {
    const s = await newStudent()
    const { challenge, code } = await requestCode(s.email)
    // N-8: queued in the secure authentication queue (encrypted), never in the staff-visible outbox
    expect(await adminSql()`select 1 from notification_messages where student_id = ${s.id} and event_key = 'portal_login_code'`).toHaveLength(0)
    const [m] = await adminSql()`select * from auth_private.auth_message_outbox where student_id = ${s.id} and kind = 'portal_login_code'`
    expect(m).toMatchObject({ channel: 'email', to_address: s.email, status: 'queued', challenge_id: challenge })
    expect(decryptAuthSecret('portal_login_code', m.secret_encrypted)).toBe(code)
    expect((await verify(challenge, code === '000000' ? '111111' : '000000')).ok).toBe(false)
    const ok = await verify(challenge, code)
    expect(ok.ok).toBe(true)
    const o = await overview(ok.th)
    expect(o!.student.code).toMatch(/^EDX-/)
    expect(o!.student.name).toBe('Portal Student')
    // single use
    expect((await verify(challenge, code)).ok).toBe(false)
  })

  it('an unknown identifier looks the same from outside but can never sign in', async () => {
    const { challenge, code } = await requestCode(`nobody.${rand()}@example.test`)
    expect(challenge).toMatch(/^[0-9a-f-]{36}$/)
    expect((await verify(challenge, code)).ok).toBe(false)
  })

  it('five wrong codes lock the challenge; requests are rate limited per identifier', async () => {
    const s = await newStudent()
    const { challenge, code } = await requestCode(s.email)
    let r = { ok: false, locked: false }
    for (let i = 0; i < 5; i++) r = await verify(challenge, code === '123456' ? '654321' : '123456')
    expect(r.locked).toBe(true)
    expect((await verify(challenge, code)).ok).toBe(false)
    for (let i = 0; i < 6; i++) await requestCode(s.email)
    const [{ n }] = await adminSql()`select count(*)::int as n from auth_private.auth_message_outbox where student_id = ${s.id} and kind = 'portal_login_code'`
    expect(n).toBe(5) // 1 + 4 more before the hourly limit of 5 per identifier
  })

  it('sessions expire after 30 minutes of inactivity', async () => {
    const s = await newStudent()
    const { challenge, code } = await requestCode(s.email)
    const { th } = await verify(challenge, code)
    expect(await overview(th)).not.toBeNull()
    await adminSql()`update auth_private.portal_sessions set last_seen_at = now() - interval '31 minutes' where token_hash = ${th}`
    expect(await overview(th)).toBeNull()
  })
})

describe('the portal shows only the student\'s own, student-facing data', () => {
  it('no internal notes, staff names of reviewers, payments or other students', async () => {
    const s = await newStudent()
    const { challenge, code } = await requestCode(s.email)
    const { th } = await verify(challenge, code)
    const json = JSON.stringify(await overview(th))
    expect(json).not.toContain('INTERNAL NOTE')
    expect(json).not.toMatch(/amount|outstanding|payment|passport_number|passport_expiry/i)
    const o = (await overview(th))!
    for (const k of ['phone', 'email', 'date_of_birth', 'parent_phone', 'notes']) expect(Object.keys(o.student)).not.toContain(k)
    expect(json).not.toContain(s.email)
    expect(Object.keys((await overview(th))!).sort()).toEqual(['company', 'documents', 'stages', 'student'])
  })

  it('uploads go only to the student\'s own documents that need a file; they start the normal review', async () => {
    const a = await newStudent()
    const b = await newStudent()
    const { th } = await verify(...Object.values(await requestCode(a.email)) as [string, string])
    const docA = ((await overview(th))!.documents as { id: string; can_upload: boolean; name: string }[]).find((d) => d.name === 'Passport')!
    const [docB] = await adminSql()`select d.id from student_documents d join document_types t on t.id = d.document_type_id where d.student_id = ${b.id} and t.key = 'passport'`
    const none = await anonymous((tx) => tx`select * from app.portal_upload_target(${th}, ${docB.id})`)
    expect(none).toHaveLength(0)
    await expectDbError(anonymous((tx) => tx`select app.portal_register_document_file(${th}, ${docB.id}, ${'org/x/' + rand()}, 'p.pdf', 'application/pdf', 10, ${'a'.repeat(64)})`), '42501')
    await anonymous((tx) => tx`select app.portal_register_document_file(${th}, ${docA.id}, ${'org/x/students/y/' + rand()}, 'p.pdf', 'application/pdf', 10, ${'a'.repeat(64)})`)
    const [d] = await adminSql()`select d.status, f.uploaded_via, f.uploaded_by from student_documents d join document_files f on f.id = d.current_file_id where d.id = ${docA.id}`
    expect(d).toMatchObject({ status: 'uploaded', uploaded_via: 'portal', uploaded_by: null })
    expect(((await overview(th))!.documents as { id: string; state: string; can_upload: boolean }[]).find((x) => x.id === docA.id)).toMatchObject({ state: 'checking', can_upload: false })
    const tl = await students.getTimeline(a.mgr, a.id)
    expect(tl.some((e) => /uploaded by the student in the portal/.test(e.summary))).toBe(true)
  })

  it('reasons for requested changes are shown to the student', async () => {
    const s = await newStudent()
    const { th } = await verify(...Object.values(await requestCode(s.email)) as [string, string])
    const doc = ((await overview(th))!.documents as { id: string; name: string }[]).find((d) => d.name === 'Passport')!
    await anonymous((tx) => tx`select app.portal_register_document_file(${th}, ${doc.id}, ${'org/z/students/w/' + rand()}, 'p.pdf', 'application/pdf', 10, ${'b'.repeat(64)})`)
    const { documentAction } = await import('@/server/services/documents')
    await documentAction(s.mgr, doc.id, 'request_changes', 'Photo page is cut off')
    const after = ((await overview(th))!.documents as { id: string; state: string; reason: string; can_upload: boolean }[]).find((x) => x.id === doc.id)
    expect(after).toMatchObject({ state: 'changes_required', reason: 'Photo page is cut off', can_upload: true })
  })
})

describe('sign-in codes are protected in the outbox', () => {
  it('counsellors see no code messages, managers only a redacted status row; codes are wiped once handed to a provider', async () => {
    const s = await newStudent()
    const { code } = await requestCode(s.email)
    const counsellor = await ctxFor('edx.counsellor@demo.test') // can see contact details, not the outbox
    expect((await notifications.listMessages(counsellor, [EDX], { studentId: s.id })).rows.filter((m) => m.event_key === 'portal_login_code')).toHaveLength(0)
    const manager = (await notifications.listMessages(await ctxFor('edx.manager@demo.test'), [EDX], { studentId: s.id })).rows.filter((m) => m.event_key === 'portal_login_code')
    expect(manager).toHaveLength(1)
    expect(manager[0]).toMatchObject({ redacted: true, status: 'queued', subject: null })
    expect(JSON.stringify(manager)).not.toContain(code)
    process.env.NOTIFICATIONS_MODE = 'live' // email not configured → skipped → code wiped
    await deliverAuthMessages(100)
    const [m] = await adminSql()`select status, secret_encrypted from auth_private.auth_message_outbox where student_id = ${s.id} and kind = 'portal_login_code'`
    expect(m).toEqual({ status: 'skipped', secret_encrypted: null })
  })
})
