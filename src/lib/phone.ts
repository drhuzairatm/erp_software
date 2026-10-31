/**
 * International phone numbers (shared by server and browser).
 * Uses libphonenumber-js (maintained Google libphonenumber metadata) for every country and territory.
 * Numbers are stored in E.164 (+<country code><number>).
 */
import { type CountryCode, getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/min'

/** Country used when a number has no "+" prefix and no country was chosen (CSV imports, API). */
export const DEFAULT_PHONE_COUNTRY: CountryCode = 'IN'

export interface PhoneCountry { code: string; name: string; dial: string; flag: string }

const flag = (cc: string) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))

let cache: PhoneCountry[] | null = null
export function phoneCountries(): PhoneCountry[] {
  if (cache) return cache
  const names = new Intl.DisplayNames(['en'], { type: 'region' })
  cache = getCountries()
    .map((code) => ({ code, name: names.of(code) ?? code, dial: getCountryCallingCode(code), flag: flag(code) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return cache
}

export function countryName(code: string | null | undefined) {
  if (!code) return null
  return phoneCountries().find((c) => c.code === code)?.name ?? code
}

export type PhoneResult = { ok: true; e164: string; country: string | null } | { ok: false; message: string }

/** Validate a number for the chosen country. Never silently switches the chosen country. */
export function normalizePhone(raw: string, country?: string | null): PhoneResult {
  const text = raw.trim()
  const cc = (country || (text.startsWith('+') ? undefined : DEFAULT_PHONE_COUNTRY)) as CountryCode | undefined
  const label = cc ? countryName(cc) : null
  if (country && text.startsWith('+')) {
    const intl = parsePhoneNumberFromString(text)
    if (intl && intl.countryCallingCode !== getCountryCallingCode(country as CountryCode)) {
      return { ok: false, message: `The number starts with +${intl.countryCallingCode} but ${label} (+${getCountryCallingCode(country as CountryCode)}) is selected. Change the country or the number.` }
    }
  }
  const n = parsePhoneNumberFromString(text, cc)
  if (!n || !n.isValid()) return { ok: false, message: label ? `Not a valid phone number for ${label} (+${getCountryCallingCode(cc!)}).` : 'Not a valid phone number.' }
  return { ok: true, e164: n.number, country: country || n.country || null }
}

/** Display form, e.g. "+91 90000 00011". Falls back to the stored text. */
export function formatPhone(value: string | null | undefined) {
  if (!value) return value ?? null
  const n = parsePhoneNumberFromString(value, value.startsWith('+') ? undefined : DEFAULT_PHONE_COUNTRY)
  return n ? n.formatInternational() : value
}
