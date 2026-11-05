import { z } from 'zod'
import { normalizePhone } from '@/lib/phone'

/** FormData → plain object; empty strings become undefined. */
export function formObject(fd: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of fd.entries()) {
    if (typeof v !== 'string' || k.startsWith('$ACTION')) continue
    const t = v.trim()
    out[k] = t === '' ? undefined : t
  }
  return out
}

export function fieldErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_'
    ;(out[key] ??= []).push(issue.message)
  }
  return out
}

const uuid = z.uuid({ message: 'Invalid selection.' })
const optUuid = uuid.optional()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.').refine((s) => !Number.isNaN(Date.parse(s)), 'Use a valid date.')
const optDate = isoDate.optional()
const text = (max: number) => z.string().max(max, `Must be at most ${max} characters.`)

export const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/

const studentObject = z.object({
    originatingOrgId: uuid,
    processingOrgId: optUuid,
    leadSourceId: optUuid,
    fullName: z.string().min(2, 'Enter the full name.').max(200),
    phone: z.string().regex(PHONE_RE, 'Enter a valid phone number (digits, spaces, + - ( ) only).').optional(),
    phoneCountry: z.string().regex(/^[A-Z]{2}$/, 'Choose a country.').optional(),
    phone2: z.string().regex(PHONE_RE, 'Enter a valid phone number (digits, spaces, + - ( ) only).').optional(),
    phone2Country: z.string().regex(/^[A-Z]{2}$/, 'Choose a country.').optional(),
    phone3: z.string().regex(PHONE_RE, 'Enter a valid phone number (digits, spaces, + - ( ) only).').optional(),
    phone3Country: z.string().regex(/^[A-Z]{2}$/, 'Choose a country.').optional(),
    phone3Label: text(60).optional(),
    residenceCountryId: optUuid,
    email: z.email('Enter a valid email address.').max(200).optional(),
    preferredLanguage: text(50).optional(),
    dateOfBirth: optDate.refine((d) => !d || d <= new Date().toISOString().slice(0, 10), 'Date of birth cannot be in the future.'),
    destinationCountryId: optUuid,
    courseId: optUuid,
    preferredUniversityId: optUuid,
    highestQualification: text(120).optional(),
    qualificationBoard: text(120).optional(),
    qualificationYear: z.coerce.number().int().min(1970).max(2100).optional(),
    qualificationScore: text(40).optional(),
    entranceExam: text(80).optional(),
    entranceScore: text(40).optional(),
    academicNotes: text(2000).optional(),
    registrationDate: optDate,
    nextAction: text(300).optional(),
    nextActionDue: optDate,
    contractingEntityId: optUuid,
    paymentRecipientEntityId: optUuid,
    counsellorId: optUuid,
    previousEducationCountryId: optUuid,
    schoolCountryId: optUuid,
    institutionName: text(200).optional(),
    passportNumber: z.string().transform((s) => s.toUpperCase().replace(/\s/g, '')).pipe(z.string().regex(/^[A-Z0-9]{5,15}$/, 'Passport number: 5–15 letters and digits.')).optional(),
    passportExpiry: optDate,
    passportCountryId: optUuid,
    preferredCampusId: optUuid,
    visaApplicationCountryId: optUuid,
    intakeId: optUuid,
    parentName: text(120).optional(),
    parentPhone: z.string().regex(PHONE_RE, 'Enter a valid phone number.').optional(),
    parentEmail: z.email('Enter a valid email address.').max(200).optional(),
    confirmDuplicate: z.literal('yes').optional(),
})

/** Validates each phone for its own country and stores it in E.164 (+countrycode…). */
function normalizePhones(v: z.infer<typeof studentObject>, ctx: z.RefinementCtx<z.infer<typeof studentObject>>) {
  for (const [f, cf] of [['phone', 'phoneCountry'], ['phone2', 'phone2Country'], ['phone3', 'phone3Country']] as const) {
    const raw = v[f]
    if (!raw) { v[cf] = undefined; continue }
    const r = normalizePhone(raw, v[cf])
    if (!r.ok) { ctx.issues.push({ code: 'custom', message: r.message, path: [f], input: raw }); continue }
    v[f] = r.e164
    v[cf] = r.country ?? undefined
  }
  if (!v.phone3) v.phone3Label = undefined
  return v
}
export const studentBaseSchema = studentObject.transform(normalizePhones)

export const studentSchema = studentObject
  .refine((v) => v.phone || v.email, { message: 'Enter a phone number or an email address.', path: ['phone'], when: () => true })
  .transform(normalizePhones)

export type StudentInput = z.infer<typeof studentSchema>

export const stageChangeSchema = z.object({
  toStage: z.string().regex(/^[a-z_]+$/),
  reason: text(1000).optional(),
  nextAction: text(300).optional(),
  nextActionDue: optDate,
  acknowledge: z.literal('yes').optional(),
})

export const noteSchema = z.object({
  orgId: uuid,
  body: z.string().min(1, 'Write a note.').max(5000),
  visibility: z.enum(['internal', 'restricted']).default('internal'),
})

export const followupSchema = z.object({
  orgId: uuid,
  channel: z.enum(['call', 'whatsapp', 'email', 'in_person', 'video', 'other']),
  summary: z.string().min(1, 'Write a summary.').max(2000),
  nextFollowupDate: optDate,
})

export const assignmentSchema = z.object({
  assignmentType: z.enum(['counsellor', 'documentation', 'visa', 'finance']),
  userId: optUuid,
  orgId: uuid,
})

export const TASK_STATUSES = ['not_started', 'in_progress', 'waiting_external', 'completed', 'cancelled'] as const
export const DELAY_REASONS = ['internal_staff', 'student', 'university', 'embassy', 'provider', 'finance', 'other_external'] as const
export const TASK_TYPES = ['general', 'followup', 'documentation', 'attestation', 'apostille', 'translation', 'university_application', 'visa', 'finance', 'travel', 'passport'] as const
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

export const taskSchema = z
  .object({
    orgId: uuid,
    studentId: optUuid,
    title: z.string().min(2, 'Enter a title.').max(200),
    description: text(4000).optional(),
    taskType: z.enum(TASK_TYPES).default('general'),
    assignedTo: optUuid,
    priority: z.enum(PRIORITIES).default('normal'),
    status: z.enum(TASK_STATUSES).default('not_started'),
    dueDate: optDate,
    dueTime: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a valid time.').optional(),
    startDate: optDate,
    completionInstructions: text(4000).optional(),
    evidenceRequired: z.preprocess((v) => v === 'on' || v === true, z.boolean()).optional(),
    requiresReview: z.preprocess((v) => v === 'on' || v === true, z.boolean()).optional(),
    delayReason: z.enum(DELAY_REASONS).optional(),
    delayNote: text(1000).optional(),
  })
  .refine((v) => v.status !== 'waiting_external' || v.delayReason, { message: 'Choose who the task is waiting on.', path: ['delayReason'] })

export const taskUpdateSchema = z
  .object({
    title: z.string().min(2).max(200).optional(),
    description: text(4000).optional(),
    assignedTo: optUuid,
    priority: z.enum(PRIORITIES).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    dueDate: optDate,
    progressPercent: z.coerce.number().int().min(0).max(100).optional(),
    delayReason: z.enum(DELAY_REASONS).optional(),
    delayNote: text(1000).optional(),
  })
  .refine((v) => v.status !== 'waiting_external' || v.delayReason, { message: 'Choose who the task is waiting on.', path: ['delayReason'] })

export const ENTRY_TYPES = ['charge', 'receipt', 'refund', 'waiver', 'disbursement'] as const
export const METHODS = ['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other'] as const

export const paymentSchema = z
  .object({
    orgId: uuid,
    entryType: z.enum(ENTRY_TYPES),
    feeCategoryId: uuid,
    amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount like 15000 or 15000.50.').refine((a) => Number(a) > 0, 'Amount must be greater than zero.'),
    entryDate: isoDate,
    method: z.enum(METHODS).optional(),
    referenceNo: text(100).optional(),
    receiptRef: text(100).optional(),
    recipientEntityId: optUuid,
    payee: text(200).optional(),
    notes: text(2000).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Choose the currency.').optional(),
    exchangeRate: z.string().regex(/^\d{1,6}(\.\d{1,8})?$/, 'Enter the rate like 83.25 (INR for 1 unit).').refine((a) => Number(a) > 0, 'The rate must be greater than zero.').optional(),
  })
  .refine((v) => !v.currency || v.currency === 'INR' || v.exchangeRate, { message: 'Enter the exchange rate applied to this payment.', path: ['exchangeRate'] })
  .refine((v) => !['receipt', 'refund'].includes(v.entryType) || v.method, { message: 'Choose the payment method.', path: ['method'] })
  .refine((v) => v.entryType !== 'disbursement' || v.payee, { message: 'Enter who was paid.', path: ['payee'] })

export const DOCUMENT_STATUSES = ['missing', 'uploaded', 'under_review', 'approved', 'rejected', 'expired'] as const
export const CUSTODY_LOCATIONS = ['with_student', 'with_staff', 'with_provider', 'at_embassy', 'at_university', 'returned_to_student'] as const

export const passwordChangeSchema = z
  .object({ current: z.string().min(1, 'Enter your current password.'), next: z.string().min(1), confirm: z.string().min(1) })
  .refine((v) => v.next === v.confirm, { message: 'Passwords do not match.', path: ['confirm'] })

const staffPhone = z.string().trim().max(40).regex(/^\+?[0-9 ()-]{5,40}$/, 'Enter a valid phone number.').optional().or(z.literal('').transform(() => undefined))
const staffDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.').optional().or(z.literal('').transform(() => undefined))
export const userCreateSchema = z.object({
  email: z.email('Enter a valid email address.').max(200),
  fullName: z.string().min(2).max(120),
  jobTitle: text(120).optional(),
  phone: staffPhone,
  joiningDate: staffDate,
  departmentId: uuid.optional().or(z.literal('').transform(() => undefined)),
  orgId: uuid,
  roleId: uuid,
})
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null))
const phoneOrEmpty = z.string().trim().max(30).regex(/^$|^\+?[0-9 ()-]{5,30}$/, 'Enter a valid phone number.').optional().transform((v) => (v ? v : null))
/** Personal details the employee may edit themselves. Administrators can edit the same fields. */
export const personalDetailsSchema = z.object({
  firstName: optionalText(60), middleName: optionalText(60), lastName: optionalText(60), displayName: z.string().trim().max(120).optional().transform((v) => (v && v.length >= 2 ? v : null)),
  phone: phoneOrEmpty, secondaryPhone: phoneOrEmpty, additionalPhone: phoneOrEmpty,
  addressLine: optionalText(300), city: optionalText(100), stateRegion: optionalText(100), postalCode: optionalText(20), addressCountry: optionalText(100),
})
export const staffDetailsSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  jobTitle: text(120).optional(),
  phone: staffPhone,
  joiningDate: staffDate,
}).extend({
  firstName: optionalText(60), middleName: optionalText(60), lastName: optionalText(60),
  secondaryPhone: phoneOrEmpty, additionalPhone: phoneOrEmpty,
  addressLine: optionalText(300), city: optionalText(100), stateRegion: optionalText(100), postalCode: optionalText(20), addressCountry: optionalText(100),
})
