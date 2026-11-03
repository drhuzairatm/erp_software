/**
 * Phase A: MD / CEO hierarchy, no-escalation rules, departments, count-only
 * payment status, and two-factor authentication.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decryptSecret, totp } from '@/lib/auth/mfa'
import { finishEnrolment, startEnrolment, verifyLoginCode } from '@/lib/auth/mfa-service'
import { hashToken, newTokenValue } from '@/lib/auth/tokens'
import { db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as admin from '@/services/admin'
import * as dashboard from '@/services/dashboard'
import * as payments from '@/services/payments'
import * as reports from '@/services/reports'
import { adminSql, as, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string, GRD: string
const roleId = async (org: string, key: string) => (await adminSql()`select id from roles where org_id = ${org} and key = ${key}`)[0].id as string
beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) {
    expect(e).toBeInstanceOf(ServiceError)
    if (kind) expect((e as ServiceError).kind).toBe(kind)
    return
  }
  throw new Error('expected a ServiceError')
}

describe('MD is the master super-admin and the MD role is locked', () => {
  it('MD holds every permission, including ones added later', async () => {
    const [{ missing }] = await adminSql()`select count(*)::int as missing from permissions p
      where not exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id where r.key = 'md' and r.org_id = ${EDX} and rp.permission_key = p.key)`
    expect(missing).toBe(0)
    await adminSql()`insert into permissions (key, category, description) values ('test.later', 'Test', 'added later')`
    const [g] = await adminSql()`select count(*)::int as n from role_permissions rp join roles r on r.id = rp.role_id where r.key = 'md' and rp.permission_key = 'test.later'`
    expect(g.n).toBe(2)
  })
  it('MD sees financial amounts', async () => {
    const md = await ctxFor('md@demo.test')
    const d = await dashboard.getDashboard(md, [EDX, GRD], {})
    expect(d.canFinance).toBe(true)
    expect(d.finance.length).toBeGreaterThan(0)
  })
  it('nobody can change the MD role in the app, not even the MD', async () => {
    const md = await ctxFor('md@demo.test')
    const mdRole = await roleId(EDX, 'md')
    await expectServiceError(admin.setRolePermissions(md, mdRole, []), 'forbidden')
    await expectDbError(as('admin@demo.test', (tx) => tx`delete from role_permissions where role_id = ${mdRole}`).then((r) => {
      if (r.count === 0) throw Object.assign(new Error('no rows'), { code: '42501' })
    }), '42501')
  })
  it('administrators cannot reset the MD\'s password or 2FA, or deactivate the MD', async () => {
    const mdId = await userId('md@demo.test')
    await expectDbError(as('admin@demo.test', (tx) => tx`select app.auth_admin_issue_reset(${mdId}, ${'x'.repeat(64)})`), '42501')
    await expectDbError(as('admin@demo.test', (tx) => tx`select app.mfa_admin_reset(${mdId}, 'Identity check attempted (fictional)')`), '42501')
    const r = await as('admin@demo.test', (tx) => tx`update user_profiles set is_active = false where id = ${mdId}`)
    expect(r.count).toBe(0)
    const ceo = await ctxFor('ceo@demo.test')
    await expectServiceError(admin.issueResetLink(ceo, mdId), 'forbidden')
  })
  it('the MD can administer the CEO', async () => {
    const md = await ctxFor('md@demo.test')
    const link = await admin.issueResetLink(md, await userId('ceo@demo.test'))
    expect(link).toMatch(/^\/reset-password\//)
  })
})

describe('CEO: operations without financial amounts', () => {
  it('cannot read ledger entries, balances or payment timeline events (database level)', async () => {
    const rows = await as('ceo@demo.test', async (tx) => ({
      entries: await tx`select id from payment_entries`,
      balances: await tx`select * from student_balances`,
      events: await tx`select id from student_events where category = 'payment'`,
      audit: await tx`select id from audit_logs`,
    }))
    for (const [k, v] of Object.entries(rows)) expect(v, k).toHaveLength(0)
  })
  it('gets payment status counts only', async () => {
    const ceo = await ctxFor('ceo@demo.test')
    const d = await dashboard.getDashboard(ceo, [EDX, GRD], {})
    expect(d.canFinance).toBe(false)
    expect(d.finance).toEqual([])
    expect(d.paymentCounts).toHaveLength(2)
    for (const c of d.paymentCounts) {
      expect(Object.keys(c).sort()).toEqual(['entries_awaiting_verification', 'org_id', 'students_awaiting_payment', 'students_with_balance'])
    }
    expect(d.paymentCounts.reduce((a, c) => a + c.students_with_balance, 0)).toBeGreaterThan(0)
  })
  it('is refused the ledger page data, balance report and finance export', async () => {
    const ceo = await ctxFor('ceo@demo.test')
    await expectServiceError(payments.listLedger(ceo, [EDX, GRD], {}), 'forbidden')
    expect(reports.reportsFor(ceo, [EDX, GRD]).map((r) => r.key)).not.toContain('balances')
    await expectServiceError(reports.exportReport(ceo, 'balances', [EDX, GRD], {}), 'not_found')
  })
  it('a user without payments.status gets no counts at all', async () => {
    const [r] = await as('edx.counsellor@demo.test', async (tx) => tx`select count(*)::int as n from app.payment_status_counts(${tx.array([EDX])}::uuid[])`)
    expect(r.n).toBe(0)
  })
})

describe('no escalation: grant only what you hold', () => {
  it('the CEO cannot create staff or administrators unless the MD allows it, and then only within their own permissions', async () => {
    const ceoCtx = await ctxFor('ceo@demo.test')
    await expectServiceError(admin.listStaff(ceoCtx), 'forbidden') // no users.manage yet
    // MD grants the CEO role "users.manage" in EDX
    const md = await ctxFor('md@demo.test')
    const ceoRole = await roleId(EDX, 'ceo')
    const current = (await adminSql()`select permission_key from role_permissions where role_id = ${ceoRole}`).map((r) => r.permission_key as string)
    await admin.setRolePermissions(md, ceoRole, [...current, 'users.manage'])
    const ceo = await ctxFor('ceo@demo.test')
    const target = await userId('grd.counsellor2@demo.test') // not yet in EDX
    const assign = (key: string) => as('ceo@demo.test', async (tx) =>
      tx`insert into organization_memberships (user_id, org_id, role_id) values (${target}, ${EDX}, ${await roleId(EDX, key)})`)
    await expectDbError(assign('system_admin'), '42501') // privileged
    await expectDbError(assign('md'), '42501')           // protected
    await expectDbError(assign('manager'), '42501')      // manager has permissions the CEO lacks
    // A role whose permissions are all held by the CEO can be assigned
    const [junior] = await adminSql()`insert into roles (org_id, key, name) values (${EDX}, 'junior_assistant', 'Junior assistant') returning id`
    await adminSql()`insert into role_permissions (role_id, permission_key) values (${junior.id}, 'dashboard.view'), (${junior.id}, 'tasks.read.all')`
    const ok = await admin.createStaff(ceo, { email: 'new.junior@example.test', fullName: 'New Junior (fictional)', orgId: EDX, roleId: junior.id })
    expect(ok.created).toBe(true)
    const visible = (await admin.listStaff(ceo)).roles.map((r) => r.key)
    expect(visible).toContain('junior_assistant')
    expect(visible).not.toContain('manager')
    expect(visible).not.toContain('system_admin')
  })
  it('nobody can grant a permission they do not hold, or edit their own role', async () => {
    // give the CEO role roles.manage via the MD, then try to grant finance access
    const md = await ctxFor('md@demo.test')
    const ceoRole = await roleId(GRD, 'ceo')
    const current = (await adminSql()`select permission_key from role_permissions where role_id = ${ceoRole}`).map((r) => r.permission_key as string)
    await admin.setRolePermissions(md, ceoRole, [...current, 'roles.manage'])
    const ceo = await ctxFor('ceo@demo.test')
    const counsellorRole = await roleId(GRD, 'counsellor')
    await expectServiceError(admin.setRolePermissions(ceo, counsellorRole, ['payments.read']), 'forbidden')
    await expectDbError(as('ceo@demo.test', (tx) => tx`insert into role_permissions (role_id, permission_key) values (${counsellorRole}, 'payments.read')`), '42501')
    await expectServiceError(admin.setRolePermissions(ceo, ceoRole, [...current, 'payments.read']), 'forbidden') // own role
  })
  it('a system administrator cannot hand out roles with more access than they have', async () => {
    const target = await userId('grd.counsellor@demo.test')
    await expectDbError(as('admin@demo.test', async (tx) =>
      tx`insert into organization_memberships (user_id, org_id, role_id) values (${target}, ${EDX}, ${await roleId(EDX, 'manager')})`), '42501')
  })
})

describe('departments', () => {
  it('a membership can only use a department of the same company', async () => {
    const [grdDept] = await adminSql()`select id from departments where org_id = ${GRD} limit 1`
    await expectDbError(adminSql()`update organization_memberships set department_id = ${grdDept.id}
      where org_id = ${EDX} and user_id = ${await userId('edx.manager@demo.test')}`, '23503')
  })
  it('demo staff have departments', async () => {
    const ctx = await ctxFor('docs@demo.test')
    expect(ctx.memberships[0].departmentName).toBe('Documentation')
  })
})

describe('two-factor sign-in', () => {
  const email = 'grd.finance2@demo.test'
  let uid: string
  let secret: string
  let recovery: string[]

  async function pendingSession() {
    const token = newTokenValue()
    await adminSql()`select app.auth_create_session(${uid}, ${hashToken(token)}, 12, '127.0.0.1', 'test', true)`
    return hashToken(token)
  }
  const [stepNow] = [() => Math.floor(Date.now() / 30000)]

  it('enrolment requires a correct code and returns 10 single-use recovery codes', async () => {
    uid = await userId(email)
    const ctx = await ctxFor(email)
    const setup = await startEnrolment(ctx, email)
    expect(setup.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/)
    const [{ secret_encrypted }] = await adminSql()`select secret_encrypted from auth_private.mfa where user_id = ${uid}`
    expect(secret_encrypted).toMatch(/^v1:/)
    secret = decryptSecret(secret_encrypted)
    await expectServiceError(finishEnrolment(ctx, '000000'), 'invalid')
    recovery = await finishEnrolment(ctx, totp(secret, stepNow() - 1)) // use the previous step so "now" stays fresh
    expect(recovery).toHaveLength(10)
    const [{ n }] = await adminSql()`select count(*)::int as n from auth_private.mfa_recovery_codes where user_id = ${uid}`
    expect(n).toBe(10)
    const [h] = await adminSql()`select code_hash from auth_private.mfa_recovery_codes where user_id = ${uid} limit 1`
    expect(recovery).not.toContain(h.code_hash)
  })

  it('a password-only session is not signed in until the code is entered', async () => {
    const tokenHash = await pendingSession()
    const [s] = await adminSql()`select * from app.auth_resolve_session(${tokenHash})`
    expect(s.mfa_pending).toBe(true)
    expect(await verifyLoginCode(tokenHash, '123456')).toMatchObject({ ok: false })
    expect(await verifyLoginCode(tokenHash, totp(secret, stepNow()))).toEqual({ ok: true })
    const [after] = await adminSql()`select * from app.auth_resolve_session(${tokenHash})`
    expect(after.mfa_pending).toBe(false)
  })

  it('a code cannot be replayed', async () => {
    const tokenHash = await pendingSession()
    expect(await verifyLoginCode(tokenHash, totp(secret, stepNow()))).toMatchObject({ ok: false })
  })

  it('a recovery code works exactly once', async () => {
    const t1 = await pendingSession()
    expect(await verifyLoginCode(t1, recovery[0].toLowerCase())).toEqual({ ok: true })
    const t2 = await pendingSession()
    expect(await verifyLoginCode(t2, recovery[0])).toMatchObject({ ok: false })
  })

  it('five wrong codes cancel the sign-in', async () => {
    const tokenHash = await pendingSession()
    let r
    for (let i = 0; i < 5; i++) r = await verifyLoginCode(tokenHash, '000000')
    expect(r).toMatchObject({ ok: false, locked: true })
    const [s] = await adminSql()`select revoked_at from auth_private.sessions where token_hash = ${tokenHash}`
    expect(s.revoked_at).not.toBeNull()
    const fails = await adminSql()`select count(*)::int as n from audit_logs where action = 'mfa_failed' and actor_user_id = ${uid}`
    expect(fails[0].n).toBeGreaterThanOrEqual(5)
  })

  it('an authorised administrator can reset 2FA; it ends the person\'s sessions', async () => {
    const md = await ctxFor('md@demo.test')
    await admin.issueResetLink(md, uid) // sanity: MD can administer finance staff
    const { adminResetMfa } = await import('@/lib/auth/mfa-service')
    await adminResetMfa(md, uid, 'Identity verified by video call (fictional)')
    const rows = await adminSql()`select 1 from auth_private.mfa where user_id = ${uid}`
    expect(rows).toHaveLength(0)
    const [open] = await adminSql()`select count(*)::int as n from auth_private.sessions where user_id = ${uid} and revoked_at is null`
    expect(open.n).toBe(0)
  })

  it('MFA requirement is flagged for roles that need it', async () => {
    const md = await ctxFor('md@demo.test')
    expect(md.memberships.every((m) => m.roleRequiresMfa)).toBe(true)
    const counsellor = await ctxFor('edx.counsellor@demo.test')
    expect(counsellor.memberships.every((m) => !m.roleRequiresMfa)).toBe(true)
  })
})
