/**
 * Shared rule conditions (Phase 4). Mirrors app.condition_eval / app.conditions_valid in the database,
 * which stay authoritative for matching; this module validates input, describes conditions in plain
 * words and explains (traces) an evaluation for the rule tester.
 */
export type Leaf = { field: FieldKey; op: 'in' | 'not_in'; values: string[] } | { field: FieldKey; op: 'is_set' | 'is_not_set' }
  | { field: FieldKey; op: 'gte' | 'lte'; value: number }
export type Group = { all: Condition[] } | { any: Condition[] }
export type Condition = Group | Leaf

export type RefKind = 'country' | 'university' | 'course' | 'intake' | 'company' | 'stage' | 'document_type' | 'lead_source'
export const FIELDS = {
  nationality: { label: 'Nationality (passport)', kind: 'country' },
  citizenship: { label: 'Citizenship', kind: 'country' },
  passport_issuing_country: { label: 'Passport issuing country', kind: 'country' },
  residence_country: { label: 'Country of residence', kind: 'country' },
  previous_education_country: { label: 'Previous education country', kind: 'country' },
  school_country: { label: 'School / institution country', kind: 'country' },
  destination_country: { label: 'Destination country', kind: 'country' },
  visa_application_country: { label: 'Visa application country', kind: 'country' },
  document_issuing_country: { label: 'Document issuing country', kind: 'country' },
  university: { label: 'University', kind: 'university' },
  course: { label: 'Course', kind: 'course' },
  intake: { label: 'Intake', kind: 'intake' },
  company: { label: 'Company', kind: 'company' },
  stage: { label: 'Current stage', kind: 'stage' },
  document_type: { label: 'Document type', kind: 'document_type' },
  lead_source: { label: 'Lead source', kind: 'lead_source' },
  age: { label: 'Age (years)', kind: 'number' },
  passport_months_valid: { label: 'Passport validity (months left)', kind: 'number' },
} as const satisfies Record<string, { label: string; kind: RefKind | 'number' }>
export type FieldKey = keyof typeof FIELDS

export const OPS: Record<string, string> = { in: 'is one of', not_in: 'is not one of', is_set: 'is recorded', is_not_set: 'is not recorded', gte: 'is at least', lte: 'is at most' }

export type Names = Partial<Record<RefKind, Record<string, string>>>

const isGroup = (c: Condition): c is Group => 'all' in c || 'any' in c

/** Validates untrusted input; returns a clean condition or null (= no condition). Throws Error with a message on invalid input. */
export function parseConditions(raw: unknown, depth = 0): Condition | null {
  if (raw === null || raw === undefined || raw === '') return null
  let v = raw
  if (typeof raw === 'string') { try { v = JSON.parse(raw) } catch { throw new Error('Conditions could not be read.') } }
  if (v === null) return null
  if (typeof v !== 'object' || Array.isArray(v) || depth > 5) throw new Error('Conditions are not valid.')
  const o = v as Record<string, unknown>
  if ('all' in o || 'any' in o) {
    const key = 'all' in o ? 'all' : 'any'
    const items = o[key]
    if (!Array.isArray(items) || items.length > 50) throw new Error('Conditions are not valid.')
    const clean = items.map((x) => parseConditions(x, depth + 1)).filter((x): x is Condition => x !== null)
    if (depth === 0 && clean.length === 0) return null
    return key === 'all' ? { all: clean } : { any: clean }
  }
  const field = o.field as FieldKey
  if (!(field in FIELDS)) throw new Error('Unknown condition field.')
  const kind = FIELDS[field].kind
  const op = o.op
  if (op === 'is_set' || op === 'is_not_set') return { field, op }
  if (op === 'in' || op === 'not_in') {
    if (kind === 'number') throw new Error(`${FIELDS[field].label}: use "at least" or "at most".`)
    const values = Array.isArray(o.values) ? o.values.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)) : []
    if (!values.length) throw new Error(`${FIELDS[field].label}: choose at least one value.`)
    return { field, op, values: [...new Set(values)].slice(0, 200) }
  }
  if (op === 'gte' || op === 'lte') {
    if (kind !== 'number') throw new Error(`${FIELDS[field].label}: choose values instead of a number.`)
    const n = Number(o.value)
    if (!Number.isFinite(n) || n < 0 || n > 1200) throw new Error(`${FIELDS[field].label}: enter a number.`)
    return { field, op, value: n }
  }
  throw new Error('Unknown condition operator.')
}

/** Plain-language description, e.g. "Nationality (passport) is one of India AND (Destination country is Bulgaria OR …)". */
export function describe(c: Condition | null, names: Names, nested = false): string {
  if (!c) return 'No extra conditions'
  if (isGroup(c)) {
    const [items, joiner] = 'all' in c ? [c.all, ' AND '] : [c.any, ' OR ']
    if (!items.length) return 'No extra conditions'
    const s = items.map((x) => describe(x, names, true)).join(joiner)
    return nested && items.length > 1 ? `(${s})` : s
  }
  const f = FIELDS[c.field]
  if (c.op === 'is_set' || c.op === 'is_not_set') return `${f.label} ${OPS[c.op]}`
  if (c.op === 'gte' || c.op === 'lte') return `${f.label} ${OPS[c.op]} ${c.value}`
  const map: Record<string, string> = f.kind === 'number' ? {} : names[f.kind] ?? {}
  const values = 'values' in c ? c.values : []
  return `${f.label} ${OPS[c.op]} ${values.map((v) => map[v] ?? 'unknown').join(', ')}`
}

export interface Trace { text: string; result: boolean; children?: Trace[] }

/** Same semantics as app.condition_eval, with an explanation of every step. */
export function trace(c: Condition | null, facts: Record<string, string | number | undefined>, names: Names): Trace {
  if (!c) return { text: 'No extra conditions', result: true }
  if (isGroup(c)) {
    const all = 'all' in c
    const items = all ? c.all : c.any
    const children = items.map((x) => trace(x, facts, names))
    const result = items.length === 0 ? true : all ? children.every((x) => x.result) : children.some((x) => x.result)
    return { text: all ? 'ALL of these' : 'ANY of these', result, children }
  }
  const f = FIELDS[c.field]
  const fact = facts[c.field]
  const shown = fact === undefined ? 'not recorded' : f.kind === 'number' ? String(fact) : (names[f.kind]?.[String(fact)] ?? 'recorded')
  let result = false
  if (c.op === 'is_set') result = fact !== undefined
  else if (c.op === 'is_not_set') result = fact === undefined
  else if (c.op === 'in') result = fact !== undefined && c.values.includes(String(fact))
  else if (c.op === 'not_in') result = fact !== undefined && !c.values.includes(String(fact))
  else if (c.op === 'gte') result = typeof fact === 'number' && fact >= c.value
  else if (c.op === 'lte') result = typeof fact === 'number' && fact <= c.value
  return { text: `${describe(c, names)} — student: ${shown}`, result }
}
