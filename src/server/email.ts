import 'server-only'

/**
 * Transactional email via Resend's HTTP API. If RESEND_API_KEY is not set,
 * nothing is sent and { sent: false } is returned — callers must never claim
 * delivery in that case.
 */
export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

export async function sendEmail(to: string, subject: string, text: string): Promise<{ sent: boolean; error?: string }> {
  if (!emailConfigured()) return { sent: false, error: 'Email delivery is not configured.' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { sent: false, error: `Email provider returned ${res.status}` }
    return { sent: true }
  } catch {
    return { sent: false, error: 'Email provider could not be reached.' }
  }
}

export function appUrl(path: string) {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  return base + path
}
