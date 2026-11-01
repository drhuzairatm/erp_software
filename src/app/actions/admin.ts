'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/server/auth/session'
import { appUrl, emailConfigured, sendEmail } from '@/server/email'
import * as admin from '@/server/services/admin'
import { formObject } from '@/server/validation'
import { runAction } from './run-action'
import { parseCrop } from '@/server/services/photos'
import { removeStaffPhoto, saveStaffPhoto } from '@/server/services/staff-photos'

export async function createStaffAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    const r = await admin.createStaff(ctx, v)
    revalidatePath('/admin/users')
    // optional photo and reporting manager (the account exists even if these fail)
    const photo = fd.getAll('photo').find((f): f is File => f instanceof File && f.size > 0)
    const extra: string[] = []
    if (photo) await saveStaffPhoto(ctx, r.userId, photo, parseCrop(fd.get('photoCrop'))).catch((e) => { extra.push(`Photo not saved: ${(e as Error).message}`) })
    if (v.reportsTo) await admin.setReportingManager(ctx, r.userId, v.reportsTo).catch(() => { extra.push('Reporting manager not saved.') })
    if (extra.length && !r.created) return { ok: true, message: `${r.existingName} was added to this company. ${extra.join(' ')}` }
    if (!r.created) return { ok: true, message: `${r.existingName} already had an account and has been added to this company.` }
    const sent = await deliverInvitation(v.email ?? '', v.fullName ?? '', r.setupPath!, r.expiresAt!)
    return sent.emailed
      ? { ok: true, message: `Account created and an invitation was emailed (valid until ${fmt(r.expiresAt!)}).` }
      : { ok: true, message: `Account created. Email is not configured, so give this one-time invitation link to the person securely (valid until ${fmt(r.expiresAt!)}):`, data: { link: sent.link } }
  })
}

const fmt = (d: Date) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })
async function deliverInvitation(email: string, name: string, path: string, expiresAt: Date) {
  const link = appUrl(path)
  let emailed = false
  if (emailConfigured() && email) {
    emailed = (await sendEmail(email, 'Your staff account invitation',
      `Hello ${name},\n\nAn account has been created for you on the Dr.Expert Edulinks / GRADUATER staff portal.\n\nOpen this link to create your private password and activate your account (valid until ${fmt(expiresAt)}):\n${link}\n\nIf you were not expecting this, ignore this email.`)).sent
  }
  return { emailed, link }
}

export async function inviteAction(userId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const r = await admin.issueInvitation(ctx, userId)
    revalidatePath(`/admin/users/${userId}`); revalidatePath('/admin/users')
    const sent = await deliverInvitation(r.email, r.fullName, r.path, r.expiresAt)
    return sent.emailed ? { ok: true, message: `Invitation emailed (valid until ${fmt(r.expiresAt)}). Earlier links no longer work.` }
      : { ok: true, message: `New invitation (valid until ${fmt(r.expiresAt)}). Earlier links no longer work. Email is not configured, so share it securely:`, data: { link: sent.link } }
  })
}

export async function cancelInviteAction(userId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await admin.cancelInvitation(ctx, userId); revalidatePath(`/admin/users/${userId}`) }, 'Invitation cancelled.')
}

export async function staffStatusAction(userId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const v = formObject(fd)
  return runAction(async () => {
    const s = await admin.setStaffStatus(ctx, userId, v.status as 'active' | 'suspended' | 'terminated', v.reason)
    revalidatePath(`/admin/users/${userId}`); revalidatePath('/admin/users')
    return { ok: true, message: s === 'active' ? 'Account reactivated.' : s === 'invited' ? 'Access restored. The person still has to accept an invitation.'
      : s === 'suspended' ? 'Account suspended and signed out everywhere.' : 'Employment terminated: account closed and signed out everywhere. History is kept.' }
  })
}

export async function revokeSessionsAction(userId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const n = await admin.revokeSessions(ctx, userId)
    revalidatePath(`/admin/users/${userId}`)
    return { ok: true, message: n ? `Signed out everywhere (${n} session${n === 1 ? '' : 's'} ended).` : 'There were no active sessions.' }
  })
}

export async function staffDetailsAction(userId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await admin.updateStaffDetails(ctx, userId, formObject(fd)); revalidatePath(`/admin/users/${userId}`) }, 'Details saved.')
}

export async function reassignTasksAction(userId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const r = await admin.reassignOpenTasks(ctx, userId, String(fd.get('toUserId') ?? ''))
    revalidatePath(`/admin/users/${userId}`); revalidatePath('/tasks')
    return { ok: true, message: `${r.moved} open task${r.moved === 1 ? '' : 's'} reassigned.${r.left ? ` ${r.left} could not be moved (another company or outside your authority).` : ''}` }
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
    await admin.updateOrgSettings(ctx, orgId, v.name ?? '', (v.currency ?? 'INR').toUpperCase(), v.allowSelfVerify === 'yes', v.supportPhone, v.supportEmail, v.portalPayments === 'yes')
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

export async function staffPhotoAction(userId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    const photo = fd.getAll('photo').find((f): f is File => f instanceof File && f.size > 0)
    if (!photo) return { ok: false, message: 'Choose a photo first.' }
    await saveStaffPhoto(ctx, userId, photo, parseCrop(fd.get('photoCrop')))
    revalidatePath(`/admin/users/${userId}`); revalidatePath('/admin/users')
  }, 'Photo saved. It is now shown wherever this person appears.')
}

export async function removeStaffPhotoAction(userId: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await removeStaffPhoto(ctx, userId); revalidatePath(`/admin/users/${userId}`); revalidatePath('/admin/users') }, 'Photo removed.')
}

export async function reportingManagerAction(userId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await admin.setReportingManager(ctx, userId, String(fd.get('reportsTo') ?? '') || null); revalidatePath(`/admin/users/${userId}`) }, 'Reporting manager saved.')
}

export async function roleStructureAction(roleId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => {
    await admin.setRoleStructure(ctx, roleId, fd.get('isActive') === 'true', String(fd.get('parentRoleId') ?? '') || null)
    revalidatePath('/admin/roles')
  }, 'Role saved.')
}
