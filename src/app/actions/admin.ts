'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/server/auth/session'
import { appUrl, emailConfigured, sendEmail } from '@/server/email'
import * as admin from '@/server/services/admin'
import { formObject } from '@/server/validation'
import { runAction } from './run-action'

export async function createStaffAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    const r = await admin.createStaff(ctx, v)
    revalidatePath('/admin/users')
    if (!r.created) return { ok: true, message: `${r.existingName} already had an account and has been added to this company.` }
    const link = appUrl(r.setupPath!)
    let emailed = false
    if (emailConfigured() && v.email) emailed = (await sendEmail(v.email, 'Your staff portal account', `An account has been created for you.\n\nSet your password within 24 hours:\n${link}\n`)).sent
    return {
      ok: true,
      message: emailed ? 'Account created and a setup link was emailed.' : 'Account created. Email is not configured, so give this one-time setup link to the person securely (valid 24 hours):',
      data: emailed ? undefined : { link },
    }
  })
}

export async function membershipAction(membershipId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    await admin.updateMembership(ctx, membershipId, v.roleId ?? '', v.active === 'yes', v.departmentId)
    revalidatePath('/admin/users')
  }, 'Access updated.')
}

export async function userActiveAction(userId: string, active: boolean, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await admin.setUserActive(ctx, userId, active)
    revalidatePath('/admin/users')
  }, active ? 'Account reactivated.' : 'Account deactivated and signed out everywhere.')
}

export async function resetLinkAction(userId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const path = await admin.issueResetLink(ctx, userId)
    return { ok: true, message: 'One-time reset link (valid 24 hours). Share it securely; it replaces any earlier link:', data: { link: appUrl(path) } }
  })
}

export async function rolePermissionsAction(roleId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const perms = fd.getAll('perm').map(String)
  return runAction(async () => {
    await admin.setRolePermissions(ctx, roleId, perms)
    revalidatePath('/admin/roles')
  }, 'Permissions saved.')
}

export async function createRoleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    await admin.createRole(ctx, v.orgId ?? '', v.name ?? '', v.description)
    revalidatePath('/admin/roles')
  }, 'Role created. Now choose its permissions.')
}

export async function orgSettingsAction(orgId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    await admin.updateOrgSettings(ctx, orgId, v.name ?? '', (v.currency ?? 'INR').toUpperCase(), v.allowSelfVerify === 'yes', v.supportPhone, v.supportEmail)
    revalidatePath('/admin/settings')
  }, 'Company settings saved.')
}

export async function addReferenceAction(kind: Parameters<typeof admin.addReference>[1], _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await admin.addReference(ctx, kind, formObject(fd))
    revalidatePath('/admin/settings')
  }, 'Added.')
}

export async function toggleReferenceAction(kind: Parameters<typeof admin.toggleReference>[1], id: string, active: boolean, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await admin.toggleReference(ctx, kind, id, active)
    revalidatePath('/admin/settings')
  }, active ? 'Activated.' : 'Deactivated.')
}

export async function workflowAction(workflowId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await admin.setWorkflowStages(ctx, workflowId, fd.getAll('stage').map(String))
    await admin.setWorkflowDocuments(ctx, workflowId, fd.getAll('doc').map(String))
    revalidatePath('/admin/settings')
  }, 'Workflow saved. New requirements apply to students registered or re-assigned to this workflow from now on.')
}
