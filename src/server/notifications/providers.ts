import nodemailer, { type Transporter } from 'nodemailer'

export type Channel = 'email' | 'whatsapp' | 'sms'
export type SendResult =
  | { ok: true; provider: string; providerId: string | null }
  | { ok: false; provider: string; error: string; transient: boolean; notConfigured?: boolean }

/** Per-company settings come from the environment (secrets never live in the database). */
function env(name: string, orgCode: string) {
  return process.env[`${name}_${orgCode}`] || process.env[name] || ''
}

export function channelConfigured(channel: Channel, orgCode: string): boolean {
  if (channel === 'email') return Boolean(env('EMAIL_SMTP_URL', orgCode) && env('EMAIL_FROM', orgCode))
  if (channel === 'whatsapp') return Boolean(process.env.GALLABOX_API_KEY && process.env.GALLABOX_API_SECRET && env('GALLABOX_CHANNEL_ID', orgCode))
  return false // SMS: no provider yet (India requires DLT-registered sender and templates)
}

// ---------------------------------------------------------------------------
// Email via the company's own mail server (SMTP)
// ---------------------------------------------------------------------------
const transports = new Map<string, Transporter>()

export async function sendEmail(orgCode: string, to: string, subject: string, body: string): Promise<SendResult> {
  if (!channelConfigured('email', orgCode)) return { ok: false, provider: 'smtp', error: 'Email is not configured for this company', transient: false, notConfigured: true }
  const url = env('EMAIL_SMTP_URL', orgCode)
  let t = transports.get(url)
  if (!t) {
    // Connection string, e.g. smtps://user:password@smtp.yourprovider.com:465 (timeouts can be added as URL query options)
    t = nodemailer.createTransport(url)
    transports.set(url, t)
  }
  try {
    const info = await t.sendMail({ from: env('EMAIL_FROM', orgCode), to, subject, text: body })
    return { ok: true, provider: 'smtp', providerId: info.messageId ?? null }
  } catch (e) {
    const err = e as { responseCode?: number; code?: string; message?: string }
    // 4xx SMTP replies and network problems are temporary; 5xx are permanent (e.g. bad address)
    const transient = !err.responseCode || (err.responseCode >= 400 && err.responseCode < 500)
    return { ok: false, provider: 'smtp', error: `${err.responseCode ?? err.code ?? ''} ${err.message ?? 'send failed'}`.trim().slice(0, 300), transient }
  }
}

// ---------------------------------------------------------------------------
// WhatsApp via Gallabox.
// NOTE: The request format follows Gallabox's devapi as commonly used
// (apikey/apiSecret headers; channelId, recipient, template name and named
// body values). It has NOT been verified against a live Gallabox account.
// Confirm with Gallabox before switching NOTIFICATIONS_MODE to live.
// ---------------------------------------------------------------------------
export function gallaboxBody(channelId: string, phoneDigits: string, name: string, templateName: string, params: string[], vars: Record<string, unknown>) {
  // params entries: "gallaboxVariable=placeholder" or just "placeholder" (same name)
  const bodyValues: Record<string, string> = {}
  for (const p of params) {
    const [gbVar, placeholder] = p.includes('=') ? p.split('=', 2) : [p, p]
    bodyValues[gbVar.trim()] = String(vars[placeholder.trim()] ?? '')
  }
  return {
    channelId,
    channelType: 'whatsapp',
    recipient: { name, phone: phoneDigits },
    whatsapp: { type: 'template', template: { templateName, bodyValues } },
  }
}

export async function sendWhatsApp(orgCode: string, phoneDigits: string, name: string, templateName: string | null, params: string[], vars: Record<string, unknown>): Promise<SendResult> {
  if (!channelConfigured('whatsapp', orgCode)) return { ok: false, provider: 'gallabox', error: 'WhatsApp (Gallabox) is not configured for this company', transient: false, notConfigured: true }
  if (!templateName) return { ok: false, provider: 'gallabox', error: 'No approved WhatsApp template name is set on this template', transient: false }
  const url = process.env.GALLABOX_API_URL || 'https://server.gallabox.com/devapi/messages/whatsapp'
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: process.env.GALLABOX_API_KEY!, apiSecret: process.env.GALLABOX_API_SECRET!, 'Content-Type': 'application/json' },
      body: JSON.stringify(gallaboxBody(env('GALLABOX_CHANNEL_ID', orgCode), phoneDigits, name, templateName, params, vars)),
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, provider: 'gallabox', error: `HTTP ${res.status}: ${text.slice(0, 250)}`, transient: res.status === 429 || res.status >= 500 }
    let id: string | null = null
    try { const j = JSON.parse(text); id = j.id ?? j.messageId ?? j._id ?? j.data?.id ?? null } catch { /* non-JSON success */ }
    return { ok: true, provider: 'gallabox', providerId: id }
  } catch (e) {
    return { ok: false, provider: 'gallabox', error: (e as Error).message?.slice(0, 250) ?? 'network error', transient: true }
  }
}
