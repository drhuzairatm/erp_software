/** Phase A – staff account security: invitations, states, sign out everywhere, task hand-over, protected MD (fictional data). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous, db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import { acceptInvitation, invitationInfo } from '@/lib/auth/passwords'
import { hashToken, newTokenValue } from '@/lib/auth/tokens'
import * as admin from '@/services/admin'
import { adminSql, ctxFor, expectDbError, orgId, userId } from '../support/helpers'

let EDX: string
const rand = () => String(Math.floor(Math.random() * 900000) + 100000)
const PASSWORD = 'Fictional-Pass-4821!'
const roleId = async (key: string) => (await adminSql()`select id from roles where org_id = ${EDX} and key = ${key}`)[0].id as string

beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}
const tokenOf = (path: string) => path.split('/').pop()!
const status = async (id: string) => (await adminSql()`select account_status, is_active, email_verified_at from user_profiles where id = ${id}`)[0]
const canSignIn = async (email: string) => (await anonymous((tx) => tx`select * from app.auth_login_lookup(${email})`)).length > 0
async function newSession(uid: string) {
  const token = newTokenValue()
  await adminSql()`select app.auth_create_session(${uid}, ${hashToken(token)}, 12, '127.0.0.1', 'vitest', false)`
  return token
}
const sessionValid = async (token: string) => (await anonymous((tx) => tx`select * from app.auth_resolve_session(${hashToken(token)})`)).length > 0

/** MD invites a new counsellor; returns ids and the invitation token. */
async function invite(roleKey = 'counsellor') {
  const md = await ctxFor('md@demo.test')
  const email = `invitee.${rand()}@example.test`
  const r = await admin.createStaff(md, { email, fullName: `Invited Person ${rand()}`, orgId: EDX, roleId: await roleId(roleKey), phone: '+91 98765 43210', joiningDate: '2026-11-02' })
  return { id: r.userId, email, token: tokenOf(r.setupPath!), r }
}
async function activeStaff(roleKey = 'counsellor') {
  const p = await invite(roleKey)
  await acceptInvitation(p.token, PASSWORD, PASSWORD)
  return p
}

describe('invitations', () => {
  it('a new employee starts as "Invitation pending", cannot sign in, accepts the invitation and becomes active with a confirmed email', async () => {
    const p = await invite()
    expect(p.r.created).toBe(true)
    expect(p.r.setupPath).toMatch(/^\/invite\//)
    expect(new Date(p.r.expiresAt!).getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600e3) // default 7 days
    expect(await status(p.id)).toMatchObject({ account_status: 'invited', is_active: true, email_verified_at: null })
    expect((await adminSql()`select phone, joining_date::text as d from user_profiles where id = ${p.id}`)[0]).toMatchObject({ phone: '+91 98765 43210', d: '2026-11-02' })
    expect(await canSignIn(p.email)).toBe(false)
    expect((await invitationInfo(p.token))?.email).toBe(p.email)
    // weak password refused; nothing activated
    await expectServiceError(acceptInvitation(p.token, 'short', 'short'), 'invalid')
    expect((await status(p.id)).account_status).toBe('invited')
    await acceptInvitation(p.token, PASSWORD, PASSWORD)
    const s = await status(p.id)
    expect(s.account_status).toBe('active')
    expect(s.email_verified_at).not.toBeNull()
    expect(await canSignIn(p.email)).toBe(true)
    // the link is single-use, and an active person cannot be re-invited
    expect(await invitationInfo(p.token)).toBeNull()
    await expectServiceError(acceptInvitation(p.token, PASSWORD, PASSWORD), 'invalid')
    await expect(admin.issueInvitation(await ctxFor('md@demo.test'), p.id)).rejects.toThrow()
    // passwords are never stored in plain text
    const [c] = await adminSql()`select password_hash from auth_private.credentials where user_id = ${p.id}`
    expect(c.password_hash).toMatch(/^\$argon2id\$/)
    expect((await adminSql()`select count(*)::int as n from audit_logs where entity_id = ${p.id} and action in ('staff_invitation_issued', 'staff_invitation_accepted')`)[0].n).toBe(2)
  })

  it('expired and replaced invitations stop working; resending issues a new link', async () => {
    const md = await ctxFor('md@demo.test')
    const p = await invite()
    const again = await admin.issueInvitation(md, p.id)
    expect(await invitationInfo(p.token)).toBeNull() // replaced
    const t2 = tokenOf(again.path)
    expect(await invitationInfo(t2)).not.toBeNull()
    await adminSql()`update auth_private.staff_invitations set expires_at = now() - interval '1 minute' where token_hash = ${hashToken(t2)}`
    expect(await invitationInfo(t2)).toBeNull()
    await expectServiceError(acceptInvitation(t2, PASSWORD, PASSWORD), 'invalid')
    expect((await admin.getStaffMember(md, p.id))!.invitation?.state).toBe('expired')
    const t3 = tokenOf((await admin.issueInvitation(md, p.id)).path)
    await acceptInvitation(t3, PASSWORD, PASSWORD)
    expect((await status(p.id)).account_status).toBe('active')
    // a cancelled invitation cannot be used
    const q = await invite()
    await admin.cancelInvitation(md, q.id)
    expect(await invitationInfo(q.token)).toBeNull()
  })

  it('duplicate and unauthorised invitations are refused', async () => {
    const md = await ctxFor('md@demo.test')
    const p = await invite()
    await expectServiceError(admin.createStaff(md, { email: p.email.toUpperCase(), fullName: 'Duplicate', orgId: EDX, roleId: await roleId('counsellor') }), 'invalid')
    for (const email of ['edx.counsellor@demo.test', 'edx.manager@demo.test']) {
      const ctx = await ctxFor(email)
      await expectServiceError(admin.createStaff(ctx, { email: `x.${rand()}@example.test`, fullName: 'Not Allowed', orgId: EDX, roleId: await roleId('counsellor') }), 'forbidden')
      await expect(admin.issueInvitation(ctx, p.id)).rejects.toThrow()
    }
    // a System Administrator cannot invite someone into a role with more access than their own (privileged roles)
    const sys = await ctxFor('admin@demo.test')
    await expectServiceError(admin.createStaff(sys, { email: `esc.${rand()}@example.test`, fullName: 'Escalation', orgId: EDX, roleId: await roleId('md') }))
    // garbage tokens
    expect(await invitationInfo('not-a-token')).toBeNull()
    expect(await invitationInfo('A'.repeat(43))).toBeNull()
  })
})

describe('suspension, termination and sign out everywhere', () => {
  it('suspension ends sessions at once, blocks sign-in and password links; reactivation restores access; history is kept', async () => {
    const md = await ctxFor('md@demo.test')
    const p = await activeStaff()
    const s1 = await newSession(p.id); const s2 = await newSession(p.id)
    expect(await sessionValid(s1)).toBe(true)
    const reset = await admin.issueResetLink(md, p.id)
    await expectServiceError(admin.setStaffStatus(md, p.id, 'suspended', ''), 'invalid') // reason required
    expect(await admin.setStaffStatus(md, p.id, 'suspended', 'Investigation (fictional)')).toBe('suspended')
    expect(await sessionValid(s1)).toBe(false)
    expect(await sessionValid(s2)).toBe(false)
    expect(await canSignIn(p.email)).toBe(false)
    expect((await anonymous((tx) => tx<{ ok: boolean }[]>`select app.auth_reset_is_valid(${hashToken(tokenOf(reset))}) as ok`))[0].ok).toBe(false)
    expect((await adminSql()`select status_reason, status_changed_by from user_profiles where id = ${p.id}`)[0]).toMatchObject({ status_reason: 'Investigation (fictional)', status_changed_by: md.userId })
    expect(await admin.setStaffStatus(md, p.id, 'active')).toBe('active')
    expect(await canSignIn(p.email)).toBe(true)
    expect(await sessionValid(s1)).toBe(false) // old sessions stay ended
    const audits = await adminSql()`select after_data ->> 'account_status' as s from audit_logs where action = 'staff_status_changed' and entity_id = ${p.id} order by occurred_at`
    expect(audits.map((a) => a.s)).toEqual(['suspended', 'active'])
  })

  it('termination keeps records; only someone allowed to create administrators can reinstate', async () => {
    const md = await ctxFor('md@demo.test')
    const p = await activeStaff()
    const [task] = await adminSql()`insert into tasks (org_id, title, assigned_to, created_by) values (${EDX}, 'Fictional task before leaving', ${p.id}, ${md.userId}) returning id`
    await admin.setStaffStatus(md, p.id, 'terminated', 'Left the company (fictional)')
    expect(await status(p.id)).toMatchObject({ account_status: 'terminated', is_active: false })
    expect(await canSignIn(p.email)).toBe(false)
    expect((await adminSql()`select assigned_to from tasks where id = ${task.id}`)[0].assigned_to).toBe(p.id) // history kept
    // the System Administrator may suspend staff but cannot reinstate a terminated employee (needs users.create_admin, MD only)
    await expectServiceError(admin.setStaffStatus(await ctxFor('admin@demo.test'), p.id, 'active'), 'forbidden')
    expect((await status(p.id)).account_status).toBe('terminated')
    expect(await admin.setStaffStatus(md, p.id, 'active')).toBe('active')
  })

  it('nobody can change their own status or the MD\'s; managers and counsellors cannot change status at all', async () => {
    const md = await ctxFor('md@demo.test')
    const p = await activeStaff()
    await expectServiceError(admin.setStaffStatus(md, md.userId, 'suspended', 'self'), 'forbidden')
    const sys = await ctxFor('admin@demo.test')
    await expectServiceError(admin.setStaffStatus(sys, md.userId, 'suspended', 'escalation attempt'), 'forbidden')
    await expectServiceError(admin.revokeSessions(sys, md.userId), 'forbidden')
    for (const email of ['edx.manager@demo.test', 'edx.counsellor@demo.test', 'ceo@demo.test']) {
      const ctx = await ctxFor(email)
      await expectServiceError(admin.setStaffStatus(ctx, p.id, 'suspended', 'not allowed'), 'forbidden')
    }
  })

  it('sign out everywhere ends every session (own or within authority) and is audited', async () => {
    const md = await ctxFor('md@demo.test')
    const p = await activeStaff()
    const a = await newSession(p.id); const b = await newSession(p.id)
    await expectServiceError(admin.revokeSessions(await ctxFor('edx.counsellor@demo.test'), p.id), 'forbidden')
    expect(await admin.revokeSessions(md, p.id)).toBe(2)
    expect(await sessionValid(a)).toBe(false)
    expect(await sessionValid(b)).toBe(false)
    expect(await canSignIn(p.email)).toBe(true) // still allowed to sign in again
    const own = await newSession(p.id)
    expect(await admin.revokeSessions(await ctxFor(p.email), p.id)).toBe(1)
    expect(await sessionValid(own)).toBe(false)
    expect((await adminSql()`select count(*)::int as n from audit_logs where action = 'sessions_revoked' and entity_id = ${p.id}`)[0].n).toBe(2)
  })

  it('the older activate/deactivate path still works and maps to suspended', async () => {
    const md = await ctxFor('md@demo.test')
    const p = await activeStaff()
    await admin.setUserActive(md, p.id, false)
    expect((await status(p.id)).account_status).toBe('suspended')
    await admin.setUserActive(md, p.id, true)
    expect((await status(p.id)).account_status).toBe('active')
  })
})

describe('task hand-over', () => {
  it('a manager moves all open tasks to a colleague; history keeps the previous owner and who did it; closed tasks stay', async () => {
    const md = await ctxFor('md@demo.test')
    const leaver = await activeStaff(); const taker = await activeStaff()
    const mk = (title: string, st = 'not_started') => adminSql()`insert into tasks (org_id, title, assigned_to, created_by, status, completed_at)
      values (${EDX}, ${title}, ${leaver.id}, ${md.userId}, ${st}, ${st === 'completed' ? new Date() : null}) returning id`
    const [t1] = await mk('Open task one'); const [t2] = await mk('Open task two', 'in_progress'); const [done] = await mk('Finished task', 'completed')
    await expectServiceError(admin.reassignOpenTasks(await ctxFor('edx.counsellor@demo.test'), leaver.id, taker.id), 'forbidden')
    const mgr = await ctxFor('edx.manager@demo.test')
    await expectServiceError(admin.reassignOpenTasks(mgr, leaver.id, leaver.id), 'invalid')
    const r = await admin.reassignOpenTasks(mgr, leaver.id, taker.id)
    expect(r).toEqual({ moved: 2, left: 0 })
    const rows = await adminSql()`select id, assigned_to from tasks where id in (${t1.id}, ${t2.id}, ${done.id})`
    expect(rows.find((x) => x.id === done.id)!.assigned_to).toBe(leaver.id)
    expect(rows.filter((x) => x.id !== done.id).every((x) => x.assigned_to === taker.id)).toBe(true)
    const [ev] = await adminSql()`select from_value, to_value, actor_id from task_events where task_id = ${t1.id} and event_type = 'reassigned'`
    expect(ev).toMatchObject({ from_value: leaver.id, to_value: taker.id, actor_id: mgr.userId })
    expect((await adminSql()`select count(*)::int as n from audit_logs where action = 'tasks_bulk_reassigned' and entity_id = ${leaver.id}`)[0].n).toBe(1)
    // a person who is not an active member cannot receive tasks
    const [t3] = await mk('Another open task')
    await admin.setStaffStatus(md, taker.id, 'suspended', 'fictional')
    expect(await admin.reassignOpenTasks(mgr, leaver.id, taker.id)).toEqual({ moved: 0, left: 1 })
    void t3
  })
})

describe('protected MD', () => {
  it('a second MD is refused in the database unless the administrator override is set (audited); the app can never grant it', async () => {
    const [mdRole] = await adminSql()`select id from roles where org_id = ${EDX} and key = 'md'`
    const p = await activeStaff()
    await expectDbError(adminSql()`insert into organization_memberships (user_id, org_id, role_id) values (${p.id}, ${EDX}, ${mdRole.id})
      on conflict (user_id, org_id) do update set role_id = excluded.role_id`, '42501')
    // the deliberate override works (rolled back here so the demo keeps a single MD)
    await expect(adminSql().begin(async (tx) => {
      await tx`select set_config('app.allow_additional_md', 'on', true)`
      await tx`update organization_memberships set role_id = ${mdRole.id} where user_id = ${p.id} and org_id = ${EDX}`
      const [a] = await tx`select metadata from audit_logs where action = 'md_role_granted' and entity_id = ${p.id}::text`
      expect(a.metadata).toMatchObject({ additional_md_override: true })
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    // in the app: even the MD cannot assign the MD role
    const md = await ctxFor('md@demo.test')
    const [m] = await adminSql()`select id from organization_memberships where user_id = ${p.id} and org_id = ${EDX}`
    await expectServiceError(admin.updateMembership(md, m.id, mdRole.id, true), 'forbidden')
    expect((await adminSql()`select count(*)::int as n from organization_memberships om join roles r on r.id = om.role_id
      join user_profiles u on u.id = om.user_id where r.key = 'md' and om.is_active and u.is_active and om.org_id = ${EDX}`)[0].n).toBe(1)
    void userId
  })
})
