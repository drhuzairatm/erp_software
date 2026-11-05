import { anonymous } from '../db'
import { notificationsMode, testAllowed } from './mode'
import { channelConfigured, type Channel, sendEmail, sendWhatsApp } from './providers'
import { messageVars, renderTemplate, toInternationalDigits } from './render'

const MAX_ATTEMPTS = 5

export { notificationsMode, testAllowed }

interface Claimed { id: string; channel: Channel; to_address: string | null; params: Record<string, unknown>; attempts: number; recipient_type: string }

/**
 * Send due messages. Safe to run concurrently (rows are claimed with SKIP LOCKED).
 * Never marks a message "sent" unless the provider accepted it.
 */
export async function processQueue(limit = 25) {
  const claimed = await anonymous((tx) => tx<Claimed[]>`select id, channel, to_address, params, attempts, recipient_type from app.claim_notifications(${limit})`)
  const summary = { sent: 0, test: 0, failed: 0, skipped: 0, retry: 0 }
  for (const m of claimed) {
    const [c] = await anonymous((tx) => tx<{ org_code: string; company: string; student_name: string; student_code: string; parent_name: string | null; stage: string; counsellor: string | null;
      template_subject: string | null; template_body: string | null; provider_template_name: string | null; provider_params: string[] }[]>`select * from app.notification_context(${m.id})`)
    const vars = messageVars(c ?? {}, m.params ?? {})
    if (m.recipient_type === 'parent' && c?.parent_name) (vars as Record<string, unknown>).student_name = c.student_name
    const subject = m.channel === 'email' ? renderTemplate(c?.template_subject, vars) : null
    const body = renderTemplate(c?.template_body, vars)
    const finish = (status: string, provider: string | null, providerId: string | null, error: string | null, retryIn = 0) =>
      anonymous((tx) => tx`select app.finish_notification(${m.id}, ${status}, ${provider}, ${providerId}, ${error}, ${subject}, ${body}, ${retryIn})`)

    if (!m.to_address || !c) { await finish('failed', null, null, 'missing recipient or message data'); summary.failed++; continue }
    if (notificationsMode() === 'test' && !testAllowed(m.channel, m.to_address)) {
      await finish('test', null, null, 'Test mode: not sent'); summary.test++; continue
    }
    if (!channelConfigured(m.channel, c.org_code)) {
      await finish('skipped', null, null, m.channel === 'sms' ? 'SMS provider not configured (DLT registration required)' : `${m.channel} not configured`)
      summary.skipped++; continue
    }
    const result = m.channel === 'email'
      ? await sendEmail(c.org_code, m.to_address, subject || c.company, body)
      : await sendWhatsApp(c.org_code, toInternationalDigits(m.to_address), String(vars.student_name ?? ''), c.provider_template_name, c.provider_params ?? [], vars)
    if (result.ok) { await finish('sent', result.provider, result.providerId, null); summary.sent++ }
    else if (result.transient && m.attempts < MAX_ATTEMPTS) { await finish('queued', result.provider, null, result.error, 60 * 2 ** m.attempts); summary.retry++ }
    else { await finish('failed', result.provider, null, result.error); summary.failed++ }
  }
  return { processed: claimed.length, ...summary }
}
