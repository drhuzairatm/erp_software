import { toInternationalDigits } from './render'

export function notificationsMode(): 'test' | 'live' {
  return process.env.NOTIFICATIONS_MODE === 'live' ? 'live' : 'test'
}

/** In test mode, only these addresses/numbers (comma-separated) receive real messages. */
export function testAllowed(channel: 'email' | 'whatsapp' | 'sms', to: string) {
  const list = (process.env.NOTIFICATIONS_TEST_RECIPIENTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (channel === 'email') return list.includes(to.toLowerCase())
  const digits = toInternationalDigits(to)
  return list.some((x) => x.replace(/\D/g, '') && toInternationalDigits(x) === digits)
}
