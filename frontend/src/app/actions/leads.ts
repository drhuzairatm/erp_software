'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/components/action-types'
import { requireUser } from '@/lib/auth/session'
import * as leads from '@/services/leads'
import { formObject } from '@/lib/validation'
import { runAction } from './run-action'

export async function createLeadAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  let id = ''
  const r = await runAction(async () => { id = await leads.createLead(ctx, formObject(fd)) })
  if (id) redirect(`/leads/${id}?created=1`)
  return r
}

export async function updateLeadAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await leads.updateLead(ctx, id, formObject(fd)); revalidatePath(`/leads/${id}`) }, 'Details saved.')
}

export async function leadWorkAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await leads.updateLeadWork(ctx, id, formObject(fd)); revalidatePath(`/leads/${id}`) }, 'Saved.')
}

export async function routeLeadAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const org = String(fd.get('orgId') ?? '')
  return runAction(async () => { await leads.routeLead(ctx, id, org === 'central' ? null : org); revalidatePath(`/leads/${id}`) }, 'Lead routed.')
}

export async function duplicateAction(id: string, decision: 'duplicate' | 'not_duplicate', _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  return runAction(async () => { await leads.reviewDuplicate(ctx, id, decision); revalidatePath(`/leads/${id}`) },
    decision === 'duplicate' ? 'Marked as a duplicate (lead set to Invalid). Nothing was merged.' : 'Marked as not a duplicate.')
}

export async function convertLeadAction(id: string, _: ActionResult): Promise<ActionResult> {
  const ctx = await requireUser()
  let studentId = ''
  const r = await runAction(async () => {
    const res = await leads.convertLead(ctx, id)
    if (!res.ok) return { ok: false, message: `A student with the same phone, email or passport may already exist (${res.duplicates.map((d) => d.student_code).join(', ')}). Check before registering; nothing was created.` }
    studentId = res.id
  })
  if (studentId) redirect(`/students/${studentId}?created=1`)
  return r
}

export async function importLeadsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireUser()
  const file = fd.get('file')
  return runAction(async () => {
    if (!(file instanceof File) || !file.size) return { ok: false, message: 'Choose a CSV file.' }
    const r = await leads.importLeads(ctx, String(fd.get('orgId') ?? ''), fd.get('source') === 'import' ? 'import' : 'leadist', file)
    revalidatePath('/leads')
    return { ok: r.errors.length === 0, message: `${r.added} lead(s) added, ${r.skipped} already imported (skipped)${r.errors.length ? `, ${r.errors.length} row(s) with problems` : ''}.`,
      data: { errors: r.errors } }
  })
}
