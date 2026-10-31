/** Replace {{placeholders}}. Unknown placeholders become empty; values are plain text (never HTML). */
export function renderTemplate(text: string | null | undefined, vars: Record<string, unknown>): string {
  if (!text) return ''
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key: string) => {
    const v = vars[key]
    return v == null ? '' : String(v)
  }).replace(/[ \t]+\n/g, '\n').trim()
}

export const PLACEHOLDERS = ['student_name', 'student_code', 'parent_name', 'company', 'stage', 'next_action', 'next_action_due',
  'document', 'reason', 'visa_outcome', 'counsellor'] as const

const VISA: Record<string, string> = { approved: 'approved', rejected: 'not approved', pending: 'in process' }

export function messageVars(ctx: Record<string, unknown>, params: Record<string, unknown>) {
  return {
    student_name: ctx.student_name, student_code: ctx.student_code, parent_name: ctx.parent_name, company: ctx.company,
    counsellor: ctx.counsellor ?? 'your counsellor', stage: params.stage ?? ctx.stage, next_action: params.next_action ?? '',
    next_action_due: params.next_action_due ?? '', document: params.document ?? '', reason: params.reason ?? '',
    visa_outcome: VISA[String(params.visa_outcome)] ?? params.visa_outcome ?? '',
    code: params.code ?? '',
  }
}

/** International phone digits for WhatsApp/SMS (10-digit numbers get the default country code). */
export function toInternationalDigits(phone: string, defaultCountryCode = process.env.DEFAULT_COUNTRY_CODE || '91') {
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return defaultCountryCode + d
  return d.replace(/^00/, '')
}
