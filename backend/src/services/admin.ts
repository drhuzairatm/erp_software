import { randomUUID } from 'node:crypto'
import { can, orgsWith } from '../lib/auth/context'
import { hashToken, newTokenValue } from '../lib/auth/tokens'
import { forbidden, invalid, notFound } from '../lib/errors'
import { fieldErrors, staffDetailsSchema, userCreateSchema } from '../lib/validation'
import { type Ctx, PAGE_SIZE, pageOf, run } from './base'

// ---------------------------------------------------------------------------
// Staff accounts & memberships
// ---------------------------------------------------------------------------
export async function listStaff(ctx: Ctx) {
  const orgIds = orgsWith(ctx, 'users.manage')
  if (!orgIds.length) throw forbidden()
  return run(ctx, async (tx) => {
    const users = await tx<{ id: string; email: string; full_name: string; job_title: string | null; is_active: boolean; created_at: Date
      employee_id: string; reports_to: string | null; manager_name: string | null; photo_version: number | null; account_status: AccountStatus; phone: string | null }[]>`
      select distinct u.id, u.email, u.full_name, u.job_title, u.is_active, u.created_at, u.employee_id, u.reports_to, mg.full_name as manager_name,
             u.account_status, u.phone,
             (select p.version from staff_photos p where p.user_id = u.id and p.is_current) as photo_version
        from user_profiles u join organization_memberships m on m.user_id = u.id left join user_profiles mg on mg.id = u.reports_to
       where m.org_id = any(${tx.array(orgIds)}::uuid[]) order by u.full_name`
    const memberships = await tx<{ id: string; user_id: string; org_id: string; org_name: string; role_id: string; role_name: string; is_active: boolean; department_id: string | null; editable: boolean }[]>`
      select m.id, m.user_id, m.org_id, o.name as org_name, m.role_id, r.name as role_name, m.is_active, m.department_id,
             (m.user_id <> app.current_user_id() and app.can_assign_role(m.role_id)) as editable
        from organization_memberships m join organizations o on o.id = m.org_id join roles r on r.id = m.role_id
       where m.org_id = any(${tx.array(orgIds)}::uuid[]) order by o.name`
    // Only roles the current user may assign (they hold all its permissions; privileged roles need users.create_admin)
    const roles = await tx<{ id: string; org_id: string; name: string; key: string }[]>`
      select id, org_id, name, key from roles where org_id = any(${tx.array(orgIds)}::uuid[]) and is_active and app.can_assign_role(id) order by name`
    const departments = await tx<{ id: string; org_id: string; name: string }[]>`
      select id, org_id, name from departments where is_active and org_id = any(${tx.array(orgIds)}::uuid[]) order by name`
    const administerable = (await tx<{ id: string }[]>`
      select distinct m.user_id as id from organization_memberships m
       where m.org_id = any(${tx.array(orgIds)}::uuid[]) and app.can_administer_user(m.user_id)`).map((r) => r.id)
    const mfa = await tx<{ user_id: string; enabled: boolean }[]>`select * from app.mfa_status_of_staff()`
    const resets = await tx<{ user_id: string; requested_at: Date }[]>`select * from app.auth_pending_reset_requests()`
    const logins = await tx<{ user_id: string; last_login: Date }[]>`select * from app.last_logins()`
    const invitations = await tx<Invitation[]>`select * from app.staff_invitations_overview()`
    return { users, memberships, roles, departments, administerable, mfa, resets, logins, invitations, orgIds }
  })
}

/** Create a staff account (or add an existing one to this company). New people get a one-time, time-limited invitation. */
export async function createStaff(ctx: Ctx, raw: Record<string, unknown>) {
  const parsed = userCreateSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Please correct the highlighted fields.', fieldErrors(parsed.error))
  const v = parsed.data
  if (!can(ctx, 'users.manage', v.orgId)) throw forbidden('You cannot add staff to this company.')
  return run(ctx, async (tx) => {
    const [role] = await tx`select 1 from roles where id = ${v.roleId} and org_id = ${v.orgId}`
    if (!role) throw invalid('Choose a role of this company.', { roleId: ['Choose a role.'] })
    if (v.departmentId && !(await tx`select 1 from departments where id = ${v.departmentId} and org_id = ${v.orgId} and is_active`).length) {
      throw invalid('Choose a department of this company.', { departmentId: ['Choose a department.'] })
    }
    const [existing] = await tx<{ id: string; full_name: string }[]>`select * from app.find_user_by_email(${v.email})`
    let userId = existing?.id
    let created = false
    if (!userId) {
      userId = randomUUID()
      await tx`insert into user_profiles (id, email, full_name, job_title, phone, joining_date, created_by)
               values (${userId}, ${v.email.toLowerCase()}, ${v.fullName}, ${v.jobTitle ?? null}, ${v.phone ?? null}, ${v.joiningDate ?? null}, ${ctx.userId})`
      created = true
    }
    const [m] = await tx`select 1 from organization_memberships where user_id = ${userId} and org_id = ${v.orgId}`
    if (m) throw invalid('This person is already a member of this company.')
    await tx`insert into organization_memberships (user_id, org_id, role_id, department_id, created_by) values (${userId}, ${v.orgId}, ${v.roleId}, ${v.departmentId ?? null}, ${ctx.userId})`
    let setupPath: string | null = null
    let expiresAt: Date | null = null
    if (created) {
      const token = newTokenValue()
      const [r] = await tx<{ exp: Date }[]>`select app.issue_staff_invitation(${userId}, ${hashToken(token)}, ${inviteDays()}) as exp`
      setupPath = `/invite/${token}`
      expiresAt = r.exp
    }
    return { userId, created, setupPath, expiresAt, existingName: existing?.full_name ?? null }
  })
}

// ---------------------------------------------------------------------------
// Account lifecycle: invitations, status, sessions, details, task hand-over
// ---------------------------------------------------------------------------
export type AccountStatus = 'invited' | 'active' | 'suspended' | 'terminated'
export interface Invitation { user_id: string; created_at: Date; expires_at: Date; state: 'pending' | 'accepted' | 'cancelled' | 'expired' }
/** Invitation validity in days (STAFF_INVITE_DAYS, 1–14, default 7). */
export const inviteDays = () => Math.min(14, Math.max(1, Number(process.env.STAFF_INVITE_DAYS) || 7))

/** New (or replacement) invitation for someone who has not accepted yet. Earlier links stop working. */
export async function issueInvitation(ctx: Ctx, userId: string) {
  const token = newTokenValue()
  const [r] = await run(ctx, (tx) => tx<{ exp: Date; email: string; full_name: string }[]>`
    select app.issue_staff_invitation(${userId}, ${hashToken(token)}, ${inviteDays()}) as exp, u.email, u.full_name from user_profiles u where u.id = ${userId}`)
  if (!r) throw notFound()
  return { path: `/invite/${token}`, expiresAt: r.exp, email: r.email, fullName: r.full_name }
}

export async function cancelInvitation(ctx: Ctx, userId: string) {
  await run(ctx, (tx) => tx`select app.cancel_staff_invitation(${userId})`)
}

/** Suspend, terminate (reason required) or reactivate. Suspended/terminated people are signed out at once and cannot sign in. */
export async function setStaffStatus(ctx: Ctx, userId: string, status: 'active' | 'suspended' | 'terminated', reason?: string) {
  if (!['active', 'suspended', 'terminated'].includes(status)) throw invalid('Choose a status.')
  if ((status === 'suspended' || status === 'terminated') && !reason?.trim()) throw invalid('Give a reason.', { reason: ['Required.'] })
  const [r] = await run(ctx, (tx) => tx<{ s: AccountStatus }[]>`select app.set_staff_status(${userId}, ${status}, ${reason?.trim().slice(0, 500) ?? null}) as s`)
  return r.s
}

/** Sign out everywhere: ends every session of this person (or of yourself). Returns the number of sessions ended. */
export async function revokeSessions(ctx: Ctx, userId: string) {
  const [r] = await run(ctx, (tx) => tx<{ n: number }[]>`select app.revoke_user_sessions(${userId}) as n`)
  return r.n
}

export async function updateStaffDetails(ctx: Ctx, userId: string, raw: Record<string, unknown>) {
  const parsed = staffDetailsSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Please correct the highlighted fields.', fieldErrors(parsed.error))
  const v = parsed.data
  if (userId === ctx.userId) throw forbidden('Ask an administrator to change your own details.')
  return run(ctx, async (tx) => {
    const r = await tx`update user_profiles set full_name = ${v.fullName}, job_title = ${v.jobTitle ?? null}, phone = ${v.phone ?? null}, joining_date = ${v.joiningDate ?? null}
                       where id = ${userId}`
    if (r.count === 0) throw forbidden('You cannot manage this account.')
  })
}

/**
 * Hand over every open task of one person to another (companies where you may assign tasks and the new person is an
 * active member). Each task records the reassignment, who did it and the previous owner (task history).
 */
export async function reassignOpenTasks(ctx: Ctx, fromUserId: string, toUserId: string) {
  const orgIds = orgsWith(ctx, 'tasks.assign')
  if (!orgIds.length) throw forbidden('You cannot reassign tasks.')
  if (!/^[0-9a-f-]{36}$/i.test(fromUserId) || !/^[0-9a-f-]{36}$/i.test(toUserId)) throw invalid('Choose a person.', { toUserId: ['Required.'] })
  if (fromUserId === toUserId) throw invalid('Choose a different person.', { toUserId: ['Choose someone else.'] })
  return run(ctx, async (tx) => {
    const moved = await tx<{ id: string; org_id: string }[]>`
      update tasks set assigned_to = ${toUserId}
       where assigned_to = ${fromUserId} and status in ('not_started', 'in_progress', 'waiting_external')
         and org_id = any(${tx.array(orgIds)}::uuid[]) and app.user_is_active_member(${toUserId}, org_id)
      returning id, org_id`
    const [{ left }] = await tx<{ left: number }[]>`select count(*)::int as left from tasks where assigned_to = ${fromUserId}
      and status in ('not_started', 'in_progress', 'waiting_external')`
    if (moved.length) {
      await tx`select app.audit('tasks_bulk_reassigned', 'user_profiles', ${fromUserId}, null, null, null, null, 'success',
        ${tx.json({ to_user_id: toUserId, tasks: moved.length, task_ids: moved.map((t) => t.id) })})`
    }
    return { moved: moved.length, left }
  })
}

export async function updateMembership(ctx: Ctx, membershipId: string, roleId: string, active: boolean, departmentId?: string | null) {
  return run(ctx, async (tx) => {
    const [m] = await tx<{ org_id: string; user_id: string }[]>`select org_id, user_id from organization_memberships where id = ${membershipId}`
    if (!m) throw notFound()
    if (m.user_id === ctx.userId) throw forbidden('You cannot change your own access.')
    if (!can(ctx, 'users.manage', m.org_id)) throw forbidden()
    const r = await tx`update organization_memberships set role_id = ${roleId}, is_active = ${active}, department_id = ${departmentId || null}
                       where id = ${membershipId}`
    if (r.count === 0) throw forbidden('You can only assign roles whose permissions you hold yourself.')
  })
}

export async function setUserActive(ctx: Ctx, userId: string, active: boolean) {
  if (userId === ctx.userId) throw forbidden('You cannot deactivate your own account.')
  return run(ctx, async (tx) => {
    const r = await tx`update user_profiles set is_active = ${active} where id = ${userId}`
    if (r.count === 0) throw forbidden('You cannot manage this account.')
  })
}

export async function issueResetLink(ctx: Ctx, userId: string) {
  const token = newTokenValue()
  await run(ctx, (tx) => tx`select app.auth_admin_issue_reset(${userId}, ${hashToken(token)})`)
  return `/reset-password/${token}`
}

/** Staff profile (Admin → Staff → person). */
export async function getStaffMember(ctx: Ctx, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !can(ctx, 'users.manage')) return null
  return run(ctx, async (tx) => {
    const [u] = await tx<{ id: string; email: string; full_name: string; job_title: string | null; is_active: boolean; created_at: Date; employee_id: string
      reports_to: string | null; manager_name: string | null; photo_version: number | null; can_admin: boolean; can_photo: boolean
      account_status: AccountStatus; phone: string | null; joining_date: string | null; email_verified_at: Date | null; status_reason: string | null
      status_changed_at: Date | null; status_changed_by_name: string | null }[]>`
      select u.id, u.email, u.full_name, u.job_title, u.is_active, u.created_at, u.employee_id, u.reports_to, mg.full_name as manager_name,
             u.account_status, u.phone, to_char(u.joining_date, 'YYYY-MM-DD') as joining_date, u.email_verified_at, u.status_reason, u.status_changed_at,
             (select sc.full_name from user_profiles sc where sc.id = u.status_changed_by) as status_changed_by_name,
             (select p.version from staff_photos p where p.user_id = u.id and p.is_current) as photo_version,
             app.can_administer_user(u.id) as can_admin, app.can_change_staff_photo(u.id) as can_photo
        from user_profiles u left join user_profiles mg on mg.id = u.reports_to where u.id = ${userId}`
    if (!u) return null
    const memberships = await tx<{ org_name: string; role_name: string; department: string | null; is_active: boolean }[]>`
      select o.name as org_name, r.name as role_name, d.name as department, m.is_active from organization_memberships m join organizations o on o.id = m.org_id
        join roles r on r.id = m.role_id left join departments d on d.id = m.department_id where m.user_id = ${userId} order by o.name`
    const reports = await tx<{ id: string; full_name: string; employee_id: string }[]>`select id, full_name, employee_id from user_profiles where reports_to = ${userId} order by full_name`
    const managers = await tx<{ id: string; full_name: string; employee_id: string }[]>`
      select distinct u.id, u.full_name, u.employee_id from user_profiles u join organization_memberships b on b.user_id = u.id and b.is_active
        join organization_memberships a on a.org_id = b.org_id and a.user_id = ${userId}
       where u.is_active and u.id <> ${userId} order by u.full_name`
    const history = await tx<{ id: string; action: string; entity_type: string; occurred_at: Date; actor: string | null }[]>`
      select l.id::text, l.action, l.entity_type, l.occurred_at, au.full_name as actor from audit_logs l left join user_profiles au on au.id = l.actor_user_id
       where (l.entity_type in ('user_profiles', 'staff_photos', 'organization_memberships') and (l.entity_id = ${userId} or l.after_data ->> 'user_id' = ${userId} or l.before_data ->> 'user_id' = ${userId}))
       order by l.occurred_at desc limit 30`.catch(() => [])
    const [invitation] = await tx<Invitation[]>`select * from app.staff_invitations_overview() where user_id = ${userId}`
    const assignOrgs = orgsWith(ctx, 'tasks.assign')
    const [{ open_tasks }] = await tx<{ open_tasks: number }[]>`select count(*)::int as open_tasks from tasks where assigned_to = ${userId}
      and status in ('not_started', 'in_progress', 'waiting_external')`
    const handover = assignOrgs.length ? await tx<{ id: string; full_name: string; employee_id: string }[]>`
      select distinct u.id, u.full_name, u.employee_id from user_profiles u join organization_memberships m on m.user_id = u.id and m.is_active
       where u.account_status = 'active' and u.id <> ${userId} and m.org_id = any(${tx.array(assignOrgs)}::uuid[])
         and m.org_id in (select org_id from organization_memberships where user_id = ${userId}) order by u.full_name` : []
    return { user: u, memberships, reports, managers, history, invitation: invitation ?? null, openTasks: open_tasks, handover, canReassign: assignOrgs.length > 0 }
  })
}

export async function setReportingManager(ctx: Ctx, userId: string, managerId: string | null) {
  return run(ctx, (tx) => tx`select app.set_reporting_manager(${userId}, ${managerId && /^[0-9a-f-]{36}$/i.test(managerId) ? managerId : null})`)
}

export async function setRoleStructure(ctx: Ctx, roleId: string, active: boolean, parentId: string | null) {
  return run(ctx, (tx) => tx`select app.set_role_structure(${roleId}, ${active}, ${parentId && /^[0-9a-f-]{36}$/i.test(parentId) ? parentId : null})`)
}

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------
export async function listRoles(ctx: Ctx) {
  const orgIds = orgsWith(ctx, 'roles.manage')
  if (!orgIds.length) throw forbidden()
  return run(ctx, async (tx) => ({
    roles: await tx<{ id: string; org_id: string; org_name: string; key: string; name: string; description: string | null; is_system: boolean; is_privileged: boolean; is_protected: boolean; requires_mfa: boolean; perms: string[]; members: number; held_by_me: boolean
      is_active: boolean; parent_role_id: string | null; member_names: { id: string; name: string }[] }[]>`
      select r.id, r.org_id, o.name as org_name, r.key, r.name, r.description, r.is_system, r.is_privileged, r.is_protected, r.requires_mfa, r.is_active, r.parent_role_id,
             coalesce((select json_agg(json_build_object('id', u.id, 'name', u.full_name) order by u.full_name) from organization_memberships m join user_profiles u on u.id = m.user_id
                        where m.role_id = r.id and m.is_active), '[]') as member_names,
             array(select permission_key from role_permissions where role_id = r.id order by 1) as perms,
             (select count(*)::int from organization_memberships m where m.role_id = r.id and m.is_active) as members,
             app.holds_role(r.id) as held_by_me
        from roles r join organizations o on o.id = r.org_id
       where r.org_id = any(${tx.array(orgIds)}::uuid[]) order by o.name, r.name`,
    permissions: await tx<{ key: string; category: string; description: string; is_sensitive: boolean }[]>`
      select key, category, description, is_sensitive from permissions order by category, key`,
  }))
}

export async function setRolePermissions(ctx: Ctx, roleId: string, perms: string[]) {
  return run(ctx, async (tx) => {
    const [role] = await tx<{ org_id: string; held: boolean; is_protected: boolean }[]>`select org_id, app.holds_role(id) as held, is_protected from roles where id = ${roleId}`
    if (!role) throw notFound()
    if (!can(ctx, 'roles.manage', role.org_id)) throw forbidden()
    if (role.is_protected) throw forbidden('The Managing Director role is locked and always has every permission.')
    if (role.held) throw forbidden('You cannot change the permissions of a role you hold yourself. Ask another administrator.')
    const valid = new Set((await tx<{ key: string }[]>`select key from permissions`).map((p) => p.key))
    const wanted = new Set(perms.filter((p) => valid.has(p)))
    const current = new Set((await tx<{ permission_key: string }[]>`select permission_key from role_permissions where role_id = ${roleId}`).map((p) => p.permission_key))
    // Only permissions the current user holds can be granted or removed; others are left untouched.
    const mine = new Set(ctx.memberships.find((m) => m.orgId === role.org_id)?.permissions ?? [])
    for (const p of current) if (!wanted.has(p) && mine.has(p)) await tx`delete from role_permissions where role_id = ${roleId} and permission_key = ${p}`
    for (const p of wanted) {
      if (current.has(p)) continue
      if (!mine.has(p)) throw forbidden(`You cannot grant "${p}" because you do not hold it yourself.`)
      await tx`insert into role_permissions (role_id, permission_key) values (${roleId}, ${p})`
    }
  })
}

export async function createRole(ctx: Ctx, orgId: string, name: string, description?: string) {
  if (!can(ctx, 'roles.manage', orgId)) throw forbidden()
  const key = name.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
  if (key.length < 2) throw invalid('Enter a role name.')
  return run(ctx, (tx) => tx`insert into roles (org_id, key, name, description) values (${orgId}, ${key}, ${name.trim()}, ${description?.trim() || null})`)
}

// ---------------------------------------------------------------------------
// Company settings & reference data
// ---------------------------------------------------------------------------
export async function getSettings(ctx: Ctx) {
  return run(ctx, async (tx) => ({
    organizations: await tx<{ id: string; name: string; code: string; student_code_prefix: string; settings: Record<string, unknown> }[]>`
      select id, name, code, student_code_prefix, settings from organizations where app.is_member(id) order by name`,
    feeCategories: await tx<{ id: string; org_id: string; key: string; name: string; kind: string; is_active: boolean }[]>`
      select id, org_id, key, name, kind, is_active from fee_categories order by kind, name`,
    departments: await tx<{ id: string; org_id: string; name: string; is_active: boolean }[]>`
      select id, org_id, name, is_active from departments order by name`,
    leadSources: await tx<{ id: string; org_id: string; name: string; is_active: boolean }[]>`select id, org_id, name, is_active from lead_sources order by name`,
    countries: await tx<{ id: string; code: string; name: string; is_active: boolean }[]>`select id, code, name, is_active from countries order by name`,
    courses: await tx<{ id: string; code: string; name: string; is_active: boolean }[]>`select id, code, name, is_active from courses order by sort_order, name`,
    universities: await tx<{ id: string; name: string; city: string | null; country: string; is_active: boolean }[]>`
      select u.id, u.name, u.city, c.name as country, u.is_active from universities u join countries c on c.id = u.country_id order by c.name, u.name`,
    legalEntities: await tx<{ id: string; name: string; registration_ref: string | null; notes: string | null; is_active: boolean }[]>`
      select id, name, registration_ref, notes, is_active from legal_entities order by name`,
    workflows: await tx<{ id: string; name: string; description: string | null; country: string | null; course: string | null; is_default: boolean; is_active: boolean; stages: string[]; documents: { id: string; name: string; required: boolean }[] }[]>`
      select w.id, w.name, w.description, c.name as country, co.name as course, w.is_default, w.is_active,
             array(select ws.stage_key from workflow_stages ws where ws.workflow_id = w.id order by ws.sort_order) as stages,
             coalesce((select json_agg(json_build_object('id', t.id, 'name', t.name, 'required', r.is_required) order by t.sort_order)
                         from document_requirements r join document_types t on t.id = r.document_type_id where r.workflow_id = w.id), '[]') as documents
        from workflow_definitions w left join countries c on c.id = w.country_id left join courses co on co.id = w.course_id
       order by w.is_default desc, w.name`,
  }))
}

export async function updateOrgSettings(ctx: Ctx, orgId: string, name: string, currency: string, allowSelfVerify: boolean, supportPhone?: string, supportEmail?: string, portalPayments = false) {
  if (!can(ctx, 'settings.manage', orgId)) throw forbidden()
  if (!/^[A-Z]{3}$/.test(currency)) throw invalid('Currency must be a 3-letter code such as INR.')
  if (name.trim().length < 2) throw invalid('Enter the company name.')
  return run(ctx, async (tx) => {
    const r = await tx`update organizations set name = ${name.trim()},
                         settings = settings || ${tx.json({ currency, allow_self_payment_verification: allowSelfVerify,
                                                            support_phone: supportPhone?.slice(0, 40) || null, support_email: supportEmail?.slice(0, 120) || null,
                                                            portal_show_payments: portalPayments })}
                       where id = ${orgId}`
    if (r.count === 0) throw forbidden()
  })
}

type RefKind = 'country' | 'course' | 'university' | 'legal_entity' | 'lead_source' | 'fee_category' | 'department'

export async function addReference(ctx: Ctx, kind: RefKind, v: Record<string, string | undefined>) {
  const name = v.name?.trim()
  if (!name || name.length < 2) throw invalid('Enter a name.')
  return run(ctx, async (tx) => {
    switch (kind) {
      case 'country':
        if (!/^[A-Z]{2}$/.test(v.code ?? '')) throw invalid('Country code must be 2 capital letters (e.g. RU).')
        return tx`insert into countries (code, name, is_destination, is_education_origin)
                  values (${v.code!}, ${name}, ${v.use !== 'origin'}, ${v.use === 'origin' || v.use === 'both'})`
      case 'course': {
        const code = (v.code ?? name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30)
        return tx`insert into courses (code, name, academic_profile) values (${code}, ${name}, ${v.profile === 'pg_medical' ? 'pg_medical' : 'school'})`
      }
      case 'university':
        if (!v.countryId) throw invalid('Choose the country.')
        return tx`insert into universities (country_id, name, city) values (${v.countryId}, ${name}, ${v.city ?? null})`
      case 'legal_entity':
        return tx`insert into legal_entities (name, registration_ref, notes) values (${name}, ${v.registrationRef ?? null}, ${v.notes ?? null})`
      case 'lead_source':
        if (!v.orgId || !can(ctx, 'reference.manage', v.orgId)) throw forbidden()
        return tx`insert into lead_sources (org_id, name) values (${v.orgId}, ${name})`
      case 'department':
        if (!v.orgId || !can(ctx, 'departments.manage', v.orgId)) throw forbidden()
        return tx`insert into departments (org_id, name) values (${v.orgId}, ${name})`
      case 'fee_category': {
        if (!v.orgId || !can(ctx, 'settings.manage', v.orgId)) throw forbidden()
        if (v.kind !== 'service' && v.kind !== 'third_party') throw invalid('Choose service or third-party.')
        const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
        return tx`insert into fee_categories (org_id, key, name, kind) values (${v.orgId}, ${key}, ${name}, ${v.kind})`
      }
    }
  })
}

const REF_TABLES: Record<RefKind, string> = {
  country: 'countries', course: 'courses', university: 'universities', legal_entity: 'legal_entities',
  lead_source: 'lead_sources', fee_category: 'fee_categories', department: 'departments',
}

export async function toggleReference(ctx: Ctx, kind: RefKind, id: string, active: boolean) {
  const table = REF_TABLES[kind]
  if (!table) throw invalid('Unknown item.')
  return run(ctx, async (tx) => {
    const r = await tx`update ${tx(table)} set is_active = ${active} where id = ${id}`
    if (r.count === 0) throw forbidden()
  })
}

export async function setWorkflowStages(ctx: Ctx, workflowId: string, stages: string[]) {
  return run(ctx, async (tx) => {
    const valid = (await tx<{ key: string; sort_order: number }[]>`select key, sort_order from stages where kind in ('normal', 'completed')`)
    const order = new Map(valid.map((s) => [s.key, s.sort_order]))
    const chosen = stages.filter((s) => order.has(s)).sort((a, b) => order.get(a)! - order.get(b)!)
    if (!chosen.length) throw invalid('Choose at least one stage.')
    await tx`delete from workflow_stages where workflow_id = ${workflowId}`
    for (const s of chosen) await tx`insert into workflow_stages (workflow_id, stage_key, sort_order) values (${workflowId}, ${s}, ${order.get(s)!})`
  })
}

export async function setWorkflowDocuments(ctx: Ctx, workflowId: string, docTypeIds: string[]) {
  return run(ctx, async (tx) => {
    await tx`update document_requirements set is_required = false where workflow_id = ${workflowId}`
    for (const id of docTypeIds) {
      await tx`insert into document_requirements (workflow_id, document_type_id, is_required) values (${workflowId}, ${id}, true)
               on conflict (workflow_id, document_type_id) do update set is_required = true`
    }
  })
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export interface AuditFilters { action?: string; entity?: string; actor?: string; from?: string; to?: string; outcome?: string; page?: string | number }

export async function listAudit(ctx: Ctx, orgIds: string[], f: AuditFilters) {
  if (!orgIds.some((o) => can(ctx, 'audit.read', o))) throw forbidden('You do not have access to the audit log.')
  const page = pageOf(f.page)
  return run(ctx, async (tx) => {
    const conds = [tx`(a.org_id is null or a.org_id = any(${tx.array(orgIds)}::uuid[]))`]
    if (f.action && /^[a-z_]+$/.test(f.action)) conds.push(tx`a.action = ${f.action}`)
    if (f.entity && /^[a-z_]+$/.test(f.entity)) conds.push(tx`a.entity_type = ${f.entity}`)
    if (f.actor && /^[0-9a-f-]{36}$/i.test(f.actor)) conds.push(tx`a.actor_user_id = ${f.actor}`)
    if (f.outcome && /^[a-z]+$/.test(f.outcome)) conds.push(tx`a.outcome = ${f.outcome}`)
    if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(tx`a.occurred_at >= ${f.from}::date`)
    if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(tx`a.occurred_at < ${f.to}::date + 1`)
    const where = conds.reduce((x, c) => tx`${x} and ${c}`)
    const rows = await tx<{ id: string; occurred_at: Date; actor: string | null; actor_id: string | null; org_name: string | null; student_code: string | null; action: string; entity_type: string; entity_id: string | null; before_data: unknown; after_data: unknown; outcome: string; metadata: unknown; request_ip: string | null; total: string }[]>`
      select a.id, a.occurred_at, u.full_name as actor, a.actor_user_id as actor_id, o.name as org_name, s.student_code, a.action, a.entity_type, a.entity_id,
             a.before_data, a.after_data, a.outcome, a.metadata, a.request_ip, count(*) over () as total
        from audit_logs a left join user_profiles u on u.id = a.actor_user_id left join organizations o on o.id = a.org_id
        left join students s on s.id = a.student_id and app.can_read_student(s.id)
       where ${where}
       order by a.occurred_at desc, a.id desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    const actions = await tx<{ action: string }[]>`select distinct action from audit_logs order by 1`
    const entities = await tx<{ entity_type: string }[]>`select distinct entity_type from audit_logs order by 1`
    return { rows, total: Number(rows[0]?.total ?? 0), page, pageSize: PAGE_SIZE, actions: actions.map((a) => a.action), entities: entities.map((e) => e.entity_type) }
  })
}
