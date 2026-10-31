import { can } from '../auth/context'
import { forbidden, invalid } from '../errors'
import { notificationsMode, processQueue } from '../notifications/dispatcher'
import { channelConfigured, type Channel } from '../notifications/providers'
import { PLACEHOLDERS } from '../notifications/render'
import { type Ctx, PAGE_SIZE, pageOf, run } from './base'

export const CHANNELS: Channel[] = ['email', 'whatsapp', 'sms']
export const EVENTS: { key: string; label: string }[] = [
  { key: 'student_registered', label: 'Student registered' },
  { key: 'stage_changed', label: 'Admission stage changed' },
  { key: 'document_changes_required', label: 'Document needs changes' },
  { key: 'document_rejected', label: 'Document rejected' },
  { key: 'document_approved', label: 'Document approved' },
  { key: 'visa_outcome', label: 'Visa outcome updated' },
  { key: 'attestation_stage_completed', label: 'Attestation stage completed' },
  { key: 'attestation_completed', label: 'Attestation completed' },
  { key: 'one_and_same_requested', label: 'One and Same document requested' },
]

export function channelStatus(orgCodes: string[]) {
  return {
    mode: notificationsMode(),
    channels: orgCodes.map((code) => ({ code, email: channelConfigured('email', code), whatsapp: channelConfigured('whatsapp', code), sms: false })),
    placeholders: PLACEHOLDERS,
  }
}

// ---------------------------------------------------------------- consent
export async function getConsents(ctx: Ctx, studentId: string) {
  return run(ctx, async (tx) => {
    const history = await tx<{ id: string; channel: string; recipient: string; granted: boolean; source: string; recorded_at: Date; by: string | null }[]>`
      select c.id, c.channel, c.recipient, c.granted, c.source, c.recorded_at, u.full_name as by
        from contact_consents c left join user_profiles u on u.id = c.recorded_by
       where c.student_id = ${studentId} order by c.recorded_at desc, c.id desc`
    const current: Record<string, boolean> = {}
    for (const h of [...history].reverse()) current[`${h.recipient}.${h.channel}`] = h.granted
    const [{ ok }] = await tx<{ ok: boolean }[]>`select app.can_on_student(${studentId}, 'notifications.consent') as ok`
    return { history, current, canRecord: ok }
  })
}

export async function recordConsent(ctx: Ctx, studentId: string, channel: string, recipient: string, granted: boolean, source: string) {
  if (!CHANNELS.includes(channel as Channel) || !['student', 'parent'].includes(recipient)) throw invalid('Invalid consent.')
  if (!source?.trim()) throw invalid('Say how consent was given (e.g. "signed registration form", "WhatsApp reply").', { source: ['Required.'] })
  return run(ctx, (tx) => tx`select app.record_consent(${studentId}, ${channel}, ${recipient}, ${granted}, ${source.trim().slice(0, 200)})`)
}

// ---------------------------------------------------------------- outbox
export interface MessageRow {
  id: string; org_name: string; student_id: string | null; student_code: string | null; student_name: string | null; event_key: string
  channel: string; recipient_type: string; to_address: string | null; subject: string | null; body: string | null; status: string
  skip_reason: string | null; last_error: string | null; attempts: number; provider: string | null; created_at: Date; sent_at: Date | null; total?: string
}

export async function listMessages(ctx: Ctx, orgIds: string[], f: { status?: string; channel?: string; event?: string; studentId?: string; page?: string | number }) {
  const page = pageOf(f.page)
  return run(ctx, async (tx) => {
    const conds = [tx`m.org_id = any(${tx.array(orgIds)}::uuid[])`]
    if (f.status && /^[a-z]+$/.test(f.status)) conds.push(tx`m.status = ${f.status}`)
    if (f.channel && /^[a-z]+$/.test(f.channel)) conds.push(tx`m.channel = ${f.channel}`)
    if (f.event && /^[a-z_]+$/.test(f.event)) conds.push(tx`m.event_key = ${f.event}`)
    if (f.studentId && /^[0-9a-f-]{36}$/i.test(f.studentId)) conds.push(tx`m.student_id = ${f.studentId}`)
    const where = conds.reduce((a, c) => tx`${a} and ${c}`)
    const rows = await tx<MessageRow[]>`
      select m.id, o.name as org_name, m.student_id, s.student_code, s.full_name as student_name, m.event_key, m.channel, m.recipient_type,
             m.to_address, m.subject, m.body, m.status, m.skip_reason, m.last_error, m.attempts, m.provider, m.created_at, m.sent_at,
             count(*) over () as total
        from notification_messages m join organizations o on o.id = m.org_id
        left join students s on s.id = m.student_id and app.can_read_student(s.id)
       where ${where} order by m.created_at desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    return { rows, total: Number(rows[0]?.total ?? 0), page, pageSize: PAGE_SIZE }
  })
}

export async function retryMessage(ctx: Ctx, id: string) {
  await run(ctx, (tx) => tx`select app.retry_notification(${id})`)
  await processQueue(10)
}

export async function processNow(ctx: Ctx) {
  if (!can(ctx, 'notifications.manage') && !can(ctx, 'notifications.view')) throw forbidden()
  return processQueue(100)
}

// ---------------------------------------------------------------- templates & rules
export async function getNotificationSettings(ctx: Ctx) {
  return run(ctx, async (tx) => ({
    templates: await tx<{ id: string; org_id: string; name: string; channel: string; language: string; subject: string | null; body: string; provider_template_name: string | null; provider_params: string[]; is_active: boolean }[]>`
      select id, org_id, name, channel, language, subject, body, provider_template_name, provider_params, is_active
        from notification_templates order by name, channel`,
    rules: await tx<{ id: string; org_id: string; event_key: string; channel: string; audience: string; template_id: string; stage_keys: string[]; is_enabled: boolean }[]>`
      select id, org_id, event_key, channel, audience, template_id, stage_keys, is_enabled from notification_rules order by event_key, channel, audience`,
  }))
}

export async function saveTemplate(ctx: Ctx, id: string, v: Record<string, string | undefined>) {
  const body = v.body?.trim()
  if (!body) throw invalid('The message text is required.', { body: ['Required.'] })
  const params = (v.providerParams ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20)
  return run(ctx, async (tx) => {
    const r = await tx`update notification_templates set subject = ${v.subject ?? null}, body = ${body.slice(0, 4000)},
                         provider_template_name = ${v.providerTemplateName ?? null}, provider_params = ${tx.array(params)}::text[]
                       where id = ${id}`
    if (!r.count) throw forbidden('You cannot edit this template.')
  })
}

export async function saveRule(ctx: Ctx, orgId: string, eventKey: string, channel: string, audience: string, enabled: boolean, templateId: string, stageKeys: string[]) {
  if (!can(ctx, 'notifications.manage', orgId)) throw forbidden()
  if (!EVENTS.some((e) => e.key === eventKey) || !CHANNELS.includes(channel as Channel) || !['student', 'parent'].includes(audience)) throw invalid('Invalid rule.')
  return run(ctx, (tx) => tx`
    insert into notification_rules (org_id, event_key, channel, audience, template_id, is_enabled, stage_keys)
    values (${orgId}, ${eventKey}, ${channel}, ${audience}, ${templateId}, ${enabled}, ${tx.array(stageKeys)}::text[])
    on conflict (org_id, event_key, channel, audience)
    do update set is_enabled = excluded.is_enabled, template_id = excluded.template_id, stage_keys = excluded.stage_keys`)
}
