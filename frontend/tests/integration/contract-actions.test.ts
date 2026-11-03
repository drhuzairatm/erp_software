/**
 * Stage 0 characterization tests (Express refactor): the CURRENT behaviour of representative Server Actions, recorded
 * before any change. Captured: ActionResult values (ok / message / fieldErrors), redirect targets, cookies set or deleted
 * (name, attributes), revalidated paths and post-response sends scheduled with after().
 * Covered here: cross-cutting behaviour (staff sign-in/out, scope cookie, sign-in redirect for signed-out users, error and
 * validation mapping, uploads) plus the tasks module and the student-portal entry points. The remaining modules get their
 * characterization tests at the start of their own slice, before any of their code changes (see the inventory).
 *
 * Real actions, real services, throwaway test database. Only next/headers (request headers + cookie jar), next/cache
 * (revalidatePath, recorded) and next/server after() (recorded, not run) are simulated. redirect() is the real one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type CookieOp = { op: 'set'; name: string; value: string; options: Record<string, unknown> } | { op: 'delete'; name: string; options: Record<string, unknown> }
let currentHeaders = new Headers({ 'user-agent': 'vitest-contract' })
let jar = new Map<string, string>()
let cookieOps: CookieOp[] = []
vi.mock('next/headers', () => ({
  headers: async () => currentHeaders,
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (k: string) => jar.has(k),
    set: (k: string | ({ name: string; value: string } & Record<string, unknown>), v?: string, o?: Record<string, unknown>) => {
      const { name, value, ...options } = typeof k === 'string' ? { name: k, value: v!, ...(o ?? {}) } : k
      jar.set(name, value); cookieOps.push({ op: 'set', name, value, options })
    },
    delete: (k: string | ({ name: string } & Record<string, unknown>)) => {
      const { name, ...options } = typeof k === 'string' ? { name: k } : k
      jar.delete(name); cookieOps.push({ op: 'delete', name, options })
    },
  }),
}))
const revalidated = vi.hoisted(() => [] as string[])
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => { revalidated.push(p) }, revalidateTag: () => {} }))
const scheduled = vi.hoisted(() => ({ count: 0 }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => { scheduled.count++ } }))

import { forgotPasswordAction, loginAction, logoutAction } from '@/app/actions/auth'
import { uploadAction } from '@/app/actions/documents'
import { setScopeAction } from '@/app/actions/scope'
import { commentAction, createTaskAction, updateTaskAction } from '@/app/actions/tasks'
import { logoutAction as portalLogoutAction, requestCodeAction } from '@/app/portal/actions'
import type { ActionResult } from '@/components/action-types'
import { acceptInvitation } from '@/lib/auth/passwords'
import { getSession, login, SESSION_COOKIE } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { PORTAL_COOKIE } from '@/services/portal'
import { SCOPE_COOKIE } from '@/services/scope'
import * as admin from '@/services/admin'
import * as documents from '@/services/documents'
import * as students from '@/services/students'
import { adminSql, ctxFor, orgId } from '../../../backend/tests/support/helpers'

const PW = 'Fictional-Contract-Passw0rd!'
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
const INITIAL: ActionResult = { ok: false, message: '' } as ActionResult
let EDX: string; let GRD: string

/** Runs an action; a redirect() becomes { redirect: target } (from the real NEXT_REDIRECT digest). */
async function call(p: Promise<unknown>): Promise<{ result?: unknown; redirect?: string }> {
  try {
    return { result: await p }
  } catch (e) {
    const digest = (e as { digest?: string }).digest
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT;')) return { redirect: digest.split(';')[2] }
    throw e
  }
}
const form = (fields: Record<string, string | File>) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); return fd }
function freshBrowser() { jar = new Map(); cookieOps = []; currentHeaders = new Headers({ 'user-agent': 'vitest-contract' }) }
async function signIn(email: string, password = process.env.SEED_DEMO_PASSWORD!) {
  freshBrowser()
  expect(await login(email, password)).toMatchObject({ ok: true, mfaPending: false, mustChangePassword: false })
  cookieOps = []
}
/** A fresh fictional EDX counsellor with a known password (invited by the MD, invitation accepted). */
async function freshStaff() {
  const md = await ctxFor('md@demo.test')
  const [role] = await adminSql()`select id from roles where org_id = ${EDX} and key = 'counsellor'`
  const email = `contract.${rand()}@example.test`
  const r = await admin.createStaff(md, { email, fullName: `Contract Staff ${rand()}`, orgId: EDX, roleId: role.id })
  await acceptInvitation(r.setupPath!.split('/').pop()!, PW, PW)
  return email
}

beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
beforeEach(() => { revalidated.length = 0; scheduled.count = 0 })
afterAll(async () => { await adminSql().end(); await db().end() })

const SESSION_OPTIONS = { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 12 * 3600 }

describe('staff sign-in and sign-out (app/actions/auth.ts)', () => {
  it('loginAction: empty fields → the message, no cookie', async () => {
    freshBrowser()
    expect(await call(loginAction(INITIAL, form({ email: '', password: '' })))).toEqual({ result: { ok: false, message: 'Enter your email and password.' } })
    expect(cookieOps).toEqual([])
  })

  it('loginAction: wrong password → the generic message, no cookie', async () => {
    const email = await freshStaff()
    freshBrowser()
    expect(await call(loginAction(INITIAL, form({ email, password: 'wrong-password-123' })))).toEqual({ result: { ok: false, message: 'Incorrect email or password.' } })
    expect(cookieOps).toEqual([])
  })

  it('loginAction: success → redirect "/", one session cookie with the current attributes', async () => {
    const email = await freshStaff()
    freshBrowser()
    expect(await call(loginAction(INITIAL, form({ email, password: PW })))).toEqual({ redirect: '/' })
    expect(cookieOps.map((c) => ({ ...c, value: c.op === 'set' ? `<${c.value.length} chars>` : undefined }))).toEqual([
      { op: 'set', name: SESSION_COOKIE, value: `<${jar.get(SESSION_COOKIE)!.length} chars>`, options: SESSION_OPTIONS },
    ])
    expect(SESSION_COOKIE).toBe('erp_session') // development/test name; production uses __Host-erp_session
    expect(scheduled.count).toBe(0)
  })

  it('logoutAction: redirect "/login", the session cookie is deleted and the session no longer resolves', async () => {
    const email = await freshStaff()
    await signIn(email, PW)
    expect(await getSession()).not.toBeNull()
    expect(await call(logoutAction())).toEqual({ redirect: '/login' })
    expect(cookieOps).toEqual([{ op: 'delete', name: SESSION_COOKIE, options: {} }])
    expect(await getSession()).toBeNull()
  })

  it('forgotPasswordAction: empty → message; any address → the same answer and one post-response send scheduled', async () => {
    freshBrowser()
    expect(await call(forgotPasswordAction(INITIAL, form({ email: '' })))).toEqual({ result: { ok: false, message: 'Enter your email address.' } })
    expect(scheduled.count).toBe(0)
    const known = await call(forgotPasswordAction(INITIAL, form({ email: 'edx.counsellor@demo.test' })))
    const unknown = await call(forgotPasswordAction(INITIAL, form({ email: `nobody.${rand()}@example.test` })))
    expect(known).toEqual(unknown)
    expect(known).toMatchInlineSnapshot(`
      {
        "result": {
          "message": "Your request has been recorded. Email delivery is not set up yet, so please ask your administrator for a reset link.",
          "ok": true,
        },
      }
    `)
    expect(scheduled.count).toBe(2)
  })
})

describe('company scope (app/actions/scope.ts)', () => {
  it('signed out → redirect "/login", no cookie', async () => {
    freshBrowser()
    expect(await call(setScopeAction(form({ scope: EDX, back: '/tasks' })))).toEqual({ redirect: '/login' })
    expect(cookieOps).toEqual([])
  })

  it('sets erp_scope (90 days) and returns to a same-site path; an off-site "back" goes to "/"', async () => {
    await signIn('edx.manager@demo.test')
    expect(await call(setScopeAction(form({ scope: EDX, back: '/tasks' })))).toEqual({ redirect: '/tasks' })
    expect(cookieOps).toEqual([{ op: 'set', name: SCOPE_COOKIE, value: EDX, options: { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: 60 * 60 * 24 * 90 } }])
    cookieOps = []
    expect(await call(setScopeAction(form({ scope: GRD, back: '//evil.example/x' })))).toEqual({ redirect: '/' })
    // GRD is not one of this manager's companies: the value falls back to the first company
    expect(cookieOps).toMatchObject([{ op: 'set', name: SCOPE_COOKIE, value: EDX }])
  })
})

describe('tasks (app/actions/tasks.ts): redirects, messages, validation and permission errors', () => {
  it('signed out → redirect "/login"', async () => {
    freshBrowser()
    expect(await call(createTaskAction(INITIAL, form({ orgId: EDX, title: 'Contract task' })))).toEqual({ redirect: '/login' })
  })

  it('create → redirect to the new task; update and comment → messages and revalidated paths; one send scheduled per success', async () => {
    await signIn('edx.manager@demo.test')
    const created = await call(createTaskAction(INITIAL, form({ orgId: EDX, title: `Contract task ${rand()}` })))
    expect(created.redirect).toMatch(/^\/tasks\/[0-9a-f-]{36}\?created=1$/)
    expect(scheduled.count).toBe(1)
    const id = created.redirect!.split('/')[2].split('?')[0]
    expect(await call(updateTaskAction(id, INITIAL, form({ priority: 'high' })))).toEqual({ result: { ok: true, message: 'Task updated.' } })
    expect(await call(commentAction(id, INITIAL, form({ body: 'Fictional comment' })))).toEqual({ result: { ok: true, message: 'Comment added.' } })
    expect(revalidated).toEqual([`/tasks/${id}`, `/tasks/${id}`])
    expect(scheduled.count).toBe(3)
  })

  it('create from a student page (returnTo) → ok message and that page revalidated, no redirect', async () => {
    await signIn('edx.manager@demo.test')
    const returnTo = '/students/00000000-0000-4000-8000-000000000000'
    expect(await call(createTaskAction(INITIAL, form({ orgId: EDX, title: `Contract task ${rand()}`, returnTo })))).toEqual({ result: { ok: true, message: 'Task created.' } })
    expect(revalidated).toEqual([returnTo])
  })

  it('validation error → message + fieldErrors; permission error → message; nothing scheduled', async () => {
    await signIn('edx.manager@demo.test')
    expect(await call(createTaskAction(INITIAL, form({ orgId: EDX, title: 'x' })))).toMatchInlineSnapshot(`
      {
        "result": {
          "fieldErrors": {
            "title": [
              "Enter a title.",
            ],
          },
          "message": "Please correct the highlighted fields.",
          "ok": false,
        },
      }
    `)
    expect(await call(createTaskAction(INITIAL, form({ orgId: GRD, title: 'Other company task' })))).toMatchInlineSnapshot(`
      {
        "result": {
          "fieldErrors": undefined,
          "message": "You cannot create tasks for this company.",
          "ok": false,
        },
      }
    `)
    expect(await call(updateTaskAction('00000000-0000-4000-8000-000000000000', INITIAL, form({ priority: 'high' })))).toMatchInlineSnapshot(`
      {
        "result": {
          "fieldErrors": undefined,
          "message": "The record was not found or you do not have access to it.",
          "ok": false,
        },
      }
    `)
    expect(scheduled.count).toBe(0)
  })
})

describe('document upload (app/actions/documents.ts uploadAction): limits and messages', () => {
  let studentId: string; let documentId: string
  beforeAll(async () => {
    const mgr = await ctxFor('edx.manager@demo.test'); const docs = await ctxFor('docs@demo.test')
    const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Contract Upload Student', phone: `+91 90063 ${rand().slice(0, 5)}` })
    if (!r.ok) throw new Error('student not created')
    studentId = r.id
    await students.setAssignment(mgr, r.id, { assignmentType: 'documentation', userId: docs.userId, orgId: EDX })
    documentId = (await documents.getChecklist(mgr, r.id)).items.find((i) => i.type_key === 'plus_two_certificate')!.id
  })
  const pdfBytes = (n: number) => { const b = new Uint8Array(n); b.set(new TextEncoder().encode('%PDF-1.4\n')); return b }

  it('no file, over 10 MB, and a non-PDF/image disguised as .pdf: the current messages', async () => {
    await signIn('docs@demo.test')
    const results = {
      noFile: await call(uploadAction(studentId, documentId, INITIAL, form({}))),
      exactlyOverLimit: await call(uploadAction(studentId, documentId, INITIAL, form({ file: new File([pdfBytes(10 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' }) }))),
      disguised: await call(uploadAction(studentId, documentId, INITIAL, form({ file: new File([new TextEncoder().encode('<html>not a pdf</html>')], 'fake.pdf', { type: 'application/pdf' }) }))),
    }
    expect(results).toMatchInlineSnapshot(`
      {
        "disguised": {
          "result": {
            "fieldErrors": undefined,
            "message": "Only PDF, JPEG, PNG or WebP files are accepted.",
            "ok": false,
          },
        },
        "exactlyOverLimit": {
          "result": {
            "fieldErrors": undefined,
            "message": "The file is larger than 10 MB.",
            "ok": false,
          },
        },
        "noFile": {
          "result": {
            "message": "Choose a file to upload.",
            "ok": false,
          },
        },
      }
    `)
  })

  it('exactly 10 MB is accepted: the current result and revalidated path', async () => {
    await signIn('docs@demo.test')
    const res = await call(uploadAction(studentId, documentId, INITIAL, form({ file: new File([pdfBytes(10 * 1024 * 1024)], 'limit.pdf', { type: 'application/pdf' }) })))
    expect(res).toMatchInlineSnapshot(`
      {
        "result": {
          "message": "File uploaded. It now needs review.",
          "ok": true,
        },
      }
    `)
    expect({ revalidated: revalidated.map((p) => p.replace(studentId, '<student>')), scheduled: scheduled.count }).toMatchInlineSnapshot(`
      {
        "revalidated": [
          "/students/<student>",
        ],
        "scheduled": 1,
      }
    `)
  })
})

describe('student portal entry points (app/portal/actions.ts)', () => {
  it('requestCodeAction: any identifier → redirect to the code page with a challenge; one send scheduled (reveals nothing)', async () => {
    freshBrowser()
    const a = await call(requestCodeAction(INITIAL, form({ identifier: `nobody.${rand()}@example.test` })))
    expect(a.redirect).toMatch(/^\/portal\/verify\?c=[A-Za-z0-9_-]+$/)
    expect(scheduled.count).toBeGreaterThanOrEqual(1)
    expect(cookieOps).toEqual([])
  })

  it('logoutAction: redirect "/portal?signedout=1" and the portal cookie deleted on path /portal', async () => {
    freshBrowser()
    expect(await call(portalLogoutAction())).toEqual({ redirect: '/portal?signedout=1' })
    expect(cookieOps).toEqual([{ op: 'delete', name: PORTAL_COOKIE, options: { path: '/portal' } }])
    expect(PORTAL_COOKIE).toBe('erp_portal') // development/test name; production uses __Secure-erp_portal
  })
})
