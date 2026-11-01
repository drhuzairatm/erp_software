/**
 * Default configuration installed by `npm run db:provision`.
 * Everything here can be changed later in the application (Settings / Roles).
 */

export const ORGANIZATIONS = [
  { code: 'EDX', name: 'Dr.Expert Edulinks', prefix: 'EDX', settings: { currency: 'INR', allow_self_payment_verification: false } },
  { code: 'GRD', name: 'GRADUATER', prefix: 'GRD', settings: { currency: 'INR', allow_self_payment_verification: false } },
] as const

const DASH = ['dashboard.view']
const OWN_TASKS = ['tasks.read.own', 'tasks.create', 'tasks.update.own']

/**
 * flags: privileged → assigning it needs users.create_admin; protected → cannot be changed in the app
 * (MD; managed with `npm run admin:create`) and always holds every permission; mfa → two-factor required.
 */
export const DEFAULT_ROLES: { key: string; name: string; description: string; permissions: string[]; privileged?: boolean; protected?: boolean; mfa?: boolean }[] = [
  {
    key: 'md',
    name: 'Managing Director',
    description: 'Master super administrator: both companies, every module, all settings and financial amounts.',
    permissions: [], // protected role: automatically holds every permission
    privileged: true, protected: true, mfa: true,
  },
  {
    key: 'ceo',
    name: 'CEO',
    description: 'Executive operations oversight. Payment counts only; no financial amounts. Extra powers only when granted by the MD.',
    permissions: [
      ...DASH, 'dashboard.consolidated', 'staff.workload.view',
      'students.read.all', 'students.read.processing', 'students.contact.view', 'students.assign',
      'notes.read', 'documents.read', 'tasks.read.all', 'tasks.create', 'tasks.assign',
      'payments.status', 'reports.view', 'reports.export', 'leads.read',
    ],
    privileged: true, mfa: true,
  },
  {
    key: 'manager',
    name: 'Company Manager',
    description: 'Manages records and staff work within the company.',
    permissions: [
      'one_and_same.templates.approve',
      'attestation.exception',
      'attestation.process',
      'notifications.consent',
      'notifications.view',
      'documents.download',
      'documents.approve',
      'students.passport.view',
      'students.passport.verify',
      'portal.accounts.manage', 'documents.publish',
      'leads.read', 'leads.manage', 'leads.review',
      ...DASH, 'staff.workload.view',
      'students.read.all', 'students.read.processing', 'students.contact.view', 'students.create', 'students.update',
      'students.assign', 'students.merge', 'students.archive', 'students.stage.change', 'students.import',
      'stage.sales', 'stage.documents', 'stage.admission', 'stage.visa', 'stage.hold',
      'notes.read', 'notes.write', 'notes.restricted',
      'documents.read', 'documents.file.view', 'documents.upload', 'documents.review', 'documents.custody',
      'tasks.read.all', 'tasks.create', 'tasks.assign', 'tasks.update.all', 'tasks.read.own', 'tasks.update.own',
      'payments.read', 'reports.view', 'reports.export', 'reports.export.pii',
    ],
  },
  {
    key: 'counsellor',
    name: 'Sales / Counsellor',
    description: 'Registers leads and students, counselling and follow-ups. No finance or private document files.',
    permissions: [
      'notifications.consent',
      'students.passport.view',
      'portal.accounts.manage',
      'leads.read', 'leads.manage',
      ...DASH, ...OWN_TASKS,
      'students.read.all', 'students.contact.view', 'students.create', 'students.update', 'students.stage.change',
      'stage.sales', 'stage.hold', 'notes.read', 'notes.write', 'documents.read', 'documents.upload',
    ],
  },
  {
    key: 'documentation',
    name: 'Documentation Staff',
    description: 'Reviews documents for assigned students; attestation, apostille and translation work.',
    permissions: [
      'attestation.process',
      'documents.download',
      'students.passport.view',
      'students.passport.verify',
      'documents.publish',
      ...DASH, ...OWN_TASKS,
      'students.read.assigned', 'students.stage.change', 'stage.documents', 'stage.admission',
      'notes.read', 'notes.write',
      'documents.read', 'documents.file.view', 'documents.upload', 'documents.review', 'documents.custody',
    ],
  },
  {
    key: 'visa',
    name: 'Visa Coordinator',
    description: 'Visa processing, appointments, outcomes and travel preparation for assigned students.',
    permissions: [
      'documents.download',
      'students.passport.view',
      ...DASH, ...OWN_TASKS,
      'students.read.assigned', 'students.contact.view', 'students.stage.change', 'stage.visa',
      'notes.read', 'notes.write', 'documents.read', 'documents.file.view', 'documents.upload', 'documents.custody',
    ],
  },
  {
    key: 'finance',
    name: 'Finance Staff',
    description: 'Records and verifies payments, refunds and disbursements.',
    permissions: [
      ...DASH, ...OWN_TASKS,
      'students.read.all', 'students.read.processing', 'students.stage.change', 'stage.finance',
      'payments.read', 'payments.record', 'payments.verify', 'payments.reverse', 'payments.disbursement',
      'reports.view', 'reports.export', 'reports.export.finance',
    ],
    mfa: true,
  },
  {
    key: 'system_admin',
    name: 'System Administrator',
    description: 'Manages users, roles and configuration. No access to student records by default.',
    permissions: [
      'requirements.manage',
      'academic.rules.manage',
      'passport.rules.manage',
      'attestation.routes.manage',
      'notifications.manage',
      'verification.rules.manage',
      'universities.manage','users.manage', 'roles.manage', 'settings.manage', 'reference.manage', 'workflow.manage', 'departments.manage', 'audit.read'],
    privileged: true, mfa: true,
  },
]

/**
 * [code, name, destination?, previous-education country?] — PLACEHOLDERS until the business confirms the
 * real lists. Editable under Company settings.
 */
export const COUNTRIES: [string, string, boolean, boolean][] = [
  ['RU', 'Russia', true, false], ['GE', 'Georgia', true, false], ['KZ', 'Kazakhstan', true, false], ['UZ', 'Uzbekistan', true, false],
  ['KG', 'Kyrgyzstan', true, false], ['PH', 'Philippines', true, false], ['DE', 'Germany', true, false], ['GB', 'United Kingdom', true, false],
  ['IE', 'Ireland', true, false], ['BG', 'Bulgaria', true, false], ['EG', 'Egypt', true, false], ['TJ', 'Tajikistan', true, false], ['RO', 'Romania', true, false],
  ['IN', 'India', false, true], ['AE', 'United Arab Emirates', true, true], ['QA', 'Qatar', false, true], ['SA', 'Saudi Arabia', false, true],
  ['KW', 'Kuwait', false, true], ['OM', 'Oman', false, true], ['BH', 'Bahrain', false, true],
]

export const COURSES = [
  ['MBBS', 'MBBS', 10, 'school'], ['NURSING', 'Nursing', 20, 'school'], ['PG_MEDICAL', 'Postgraduate Medical', 30, 'pg_medical'],
] as const

export const DOCUMENT_TYPES = [
  ['passport', 'Passport', 'identity', true, 10],
  ['one_and_same', 'One and Same Certificate / Affidavit', 'identity', false, 15],
  ['mbbs_degree', 'MBBS Degree Certificate', 'academic', false, 32],
  ['internship_certificate', 'Internship Completion Certificate', 'academic', false, 33],
  ['medical_registration', 'Medical Council Registration', 'academic', true, 34],
  ['tenth_certificate', '10th Certificate', 'academic', false, 20],
  ['plus_two_certificate', 'Plus Two Certificate', 'academic', false, 30],
  ['bonafide_certificate', 'Bonafide Certificate', 'academic', false, 35],
  ['birth_certificate', 'Birth Certificate', 'identity', false, 40],
  ['migration_certificate', 'Migration Certificate', 'academic', false, 50],
  ['photo_white_bg', 'White-background Photograph', 'photo', false, 60],
  ['neet_scorecard', 'Entrance Exam Scorecard', 'academic', false, 70],
  ['degree_certificate', 'Degree Certificate', 'academic', false, 80],
  ['attestation_certificate', 'Attestation Certificate', 'attestation', false, 90],
  ['apostille_certificate', 'Apostille Certificate', 'attestation', false, 100],
  ['translated_documents', 'Certified Translations', 'translation', false, 110],
  ['visa_application', 'Visa Application Form', 'visa', false, 120],
  ['medical_certificate', 'Medical / HIV Certificate', 'visa', true, 130],
  ['bank_statement', 'Bank Statement / Sponsor Letter', 'financial', true, 140],
  ['birth_affidavit', 'Birth Affidavit', 'identity', false, 45],
  ['sponsor_affidavit', 'Sponsor Affidavit', 'financial', false, 145],
  ['police_clearance', 'Police Clearance Certificate (PCC)', 'visa', true, 135],
  ['language_certificate', 'Language Certificate', 'academic', true, 150],
  ['other', 'Other Supporting Document', 'other', false, 900],
] as const

const ALL_STAGES = ['lead', 'registration', 'document_collection', 'document_review', 'attestation', 'translation',
  'university_application', 'admission_letter', 'visa_processing', 'fee_clearance', 'travel_preparation', 'travel_completed']
const NO_TRANSLATION = ALL_STAGES.filter((s) => s !== 'translation')

const CORE_DOCS = ['passport', 'tenth_certificate', 'plus_two_certificate', 'bonafide_certificate', 'birth_certificate', 'photo_white_bg']

export const WORKFLOWS: { name: string; description: string; country?: string; course?: string; isDefault?: boolean; stages: string[]; documents: string[] }[] = [
  {
    name: 'Standard admission', description: 'Default workflow covering all stages.', isDefault: true,
    stages: ALL_STAGES, documents: [...CORE_DOCS, 'migration_certificate', 'attestation_certificate', 'visa_application'],
  },
  {
    name: 'MBBS – Russia', description: 'Russian universities: translation and apostille required.', country: 'RU', course: 'MBBS',
    stages: ALL_STAGES, documents: [...CORE_DOCS, 'neet_scorecard', 'apostille_certificate', 'translated_documents', 'medical_certificate', 'visa_application'],
  },
  {
    name: 'MBBS – Georgia', description: 'Georgia: apostille, no translation stage.', country: 'GE', course: 'MBBS',
    stages: NO_TRANSLATION, documents: [...CORE_DOCS, 'neet_scorecard', 'apostille_certificate', 'visa_application'],
  },
  {
    name: 'Nursing – Germany', description: 'Germany nursing: language certificate and translations.', country: 'DE', course: 'NURSING',
    stages: ALL_STAGES, documents: [...CORE_DOCS, 'degree_certificate', 'language_certificate', 'translated_documents', 'bank_statement', 'visa_application'],
  },
]

export const FEE_CATEGORIES = [
  ['registration_fee', 'Registration fee', 'service'],
  ['service_fee', 'Service fee', 'service'],
  ['documentation_fee', 'Documentation / attestation fee', 'service'],
  ['university_fee', 'University tuition (collected for university)', 'third_party'],
  ['hostel_fee', 'Hostel fee (collected for university)', 'third_party'],
  ['visa_fee', 'Visa / embassy fee', 'third_party'],
  ['provider_fee', 'Translation / attestation provider cost', 'third_party'],
] as const

export const LEAD_SOURCES = ['Walk-in', 'Website', 'Facebook / Instagram', 'Referral', 'Seminar / Event', 'Phone enquiry', 'Leadist CRM (manual)']

export const DEPARTMENTS = ['Admissions', 'Documentation', 'Attestation', 'Visa', 'Accounts', 'Management']

/**
 * Default message templates (editable in the app). WhatsApp templates must ALSO be created and approved in
 * Gallabox/Meta with the same variables; enter the approved template name in the app before enabling.
 * Placeholders: {{student_name}} {{student_code}} {{parent_name}} {{company}} {{stage}} {{next_action}}
 * {{next_action_due}} {{document}} {{reason}} {{visa_outcome}} {{counsellor}}
 */
export const NOTIFICATION_TEMPLATES: { event: string; name: string; email: { subject: string; body: string }; whatsapp: { body: string; params: string[] } }[] = [
  { event: 'student_registered', name: 'Welcome',
    email: { subject: 'Welcome to {{company}} – your Student ID {{student_code}}',
      body: 'Dear {{student_name}},\n\nThank you for registering with {{company}}. Your Student ID is {{student_code}}. Your counsellor {{counsellor}} will guide you through the next steps.\n\nRegards,\n{{company}}' },
    whatsapp: { body: 'Dear {{student_name}}, welcome to {{company}}. Your Student ID is {{student_code}}.', params: ['student_name', 'company', 'student_code'] } },
  { event: 'stage_changed', name: 'Application progress',
    email: { subject: 'Your application: {{stage}}',
      body: 'Dear {{student_name}},\n\nYour application ({{student_code}}) has moved to: {{stage}}.\nNext step: {{next_action}}\n\nRegards,\n{{company}}' },
    whatsapp: { body: 'Dear {{student_name}}, your application {{student_code}} has moved to: {{stage}}.', params: ['student_name', 'student_code', 'stage'] } },
  { event: 'document_changes_required', name: 'Document needs changes',
    email: { subject: 'Action needed: {{document}}',
      body: 'Dear {{student_name}},\n\nPlease provide a corrected {{document}}. Reason: {{reason}}\n\nRegards,\n{{company}}' },
    whatsapp: { body: 'Dear {{student_name}}, please send a corrected {{document}}. Reason: {{reason}}', params: ['student_name', 'document', 'reason'] } },
  { event: 'document_rejected', name: 'Document not accepted',
    email: { subject: 'Document not accepted: {{document}}',
      body: 'Dear {{student_name}},\n\nYour {{document}} could not be accepted. Reason: {{reason}}. Your counsellor will contact you.\n\nRegards,\n{{company}}' },
    whatsapp: { body: 'Dear {{student_name}}, your {{document}} could not be accepted. Reason: {{reason}}', params: ['student_name', 'document', 'reason'] } },
  { event: 'document_approved', name: 'Document approved',
    email: { subject: 'Document approved: {{document}}', body: 'Dear {{student_name}},\n\nYour {{document}} has been verified and approved.\n\nRegards,\n{{company}}' },
    whatsapp: { body: 'Dear {{student_name}}, your {{document}} has been verified and approved.', params: ['student_name', 'document'] } },
  { event: 'attestation_stage_completed', name: 'Attestation progress',
    email: { subject: 'Document update: {{document}}', body: 'Dear {{student_name}},\n\nYour {{document}} has completed this step: {{stage}}.\n\nRegards,\n{{company}}' },
    whatsapp: { body: 'Dear {{student_name}}, your {{document}} has completed: {{stage}}.', params: ['student_name', 'document', 'stage'] } },
  { event: 'attestation_completed', name: 'Attestation completed',
    email: { subject: 'Attestation completed: {{document}}', body: 'Dear {{student_name}},\n\nThe attestation of your {{document}} is complete.\n\nRegards,\n{{company}}' },
    whatsapp: { body: 'Dear {{student_name}}, the attestation of your {{document}} is complete.', params: ['student_name', 'document'] } },
  { event: 'one_and_same_requested', name: 'One and Same request',
    email: { subject: 'Document needed: One and Same ({{document}})', body: 'Dear {{student_name}},\n\nThe name on your {{document}} differs from the name in your passport. Please arrange a One and Same certificate/affidavit with the following wording and send it to us:\n\n{{preview}}\n\nRegards,\n{{company}}' },
    whatsapp: { body: 'Dear {{student_name}}, the name on your {{document}} differs from your passport. We have emailed the One and Same wording to you; please contact your counsellor.', params: ['student_name', 'document'] } },
  { event: 'courier_instructions_issued', name: 'Courier instructions for originals',
    email: { subject: 'Please send your original documents', body: 'Dear {{student_name}},\n\nThe scans of your {{document}} have been approved. Please sign in to the student portal to see where and how to send the original documents, and enter the courier company and tracking number there after sending.\n\nRegards,\n{{company}}' },
    whatsapp: { body: 'Dear {{student_name}}, the scans of your {{document}} are approved. Please sign in to the student portal for the courier instructions.', params: ['student_name', 'document'] } },
  { event: 'original_received', name: 'Original documents received',
    email: { subject: 'Original documents received', body: 'Dear {{student_name}},\n\nWe have received your original {{document}} at our office.\n\nRegards,\n{{company}}' },
    whatsapp: { body: 'Dear {{student_name}}, we have received your original {{document}}.', params: ['student_name', 'document'] } },
  { event: 'visa_outcome', name: 'Visa update',
    email: { subject: 'Visa update', body: 'Dear {{student_name}},\n\nThere is an update on your visa: {{visa_outcome}}. Your visa coordinator will contact you.\n\nRegards,\n{{company}}' },
    whatsapp: { body: 'Dear {{student_name}}, there is an update on your visa: {{visa_outcome}}.', params: ['student_name', 'visa_outcome'] } },
]

/**
 * Business rules supplied by the MD (Oct 2026). Installed once (matched by name); edit or switch off in the app.
 * These are the company's procedures, not legal advice.
 */
export const BUSINESS_UNIVERSITIES: [country: string, name: string, city: string][] = [
  ['BG', 'Medical University – Varna', 'Varna'],
  ['BG', 'Medical University – Pleven', 'Pleven'],
]
export const PASSPORT_VALIDITY_RULES = [
  { name: 'Passport valid for at least 12 months (all destinations)', stage: 'university_application', months: 12, enforcement: 'block',
    notes: 'MD instruction Oct 2026: 1 year+ passport validity is mandatory.' },
]
/** Country-wise requirement notices — ADVISORY: shown to staff, acknowledged, compared with marks; never blocking. */
export const ADVISORY_NOTICES = [
  { country: 'BG', title: 'BULGARIA – IMPORTANT ACADEMIC REQUIREMENTS', displayType: 'important_warning', priority: 'high',
    message: "Please note that this destination has specific academic mark requirements. Verify the student's academic records before proceeding with university selection and application.",
    notes: 'Current business rule from the brief (Oct 2026).',
    items: (['chemistry', 'biology', 'physics', 'english'] as const).map((k) => ({ subject_key: k, subject_name: k[0].toUpperCase() + k.slice(1), min_percentage: 60 })) },
]
/** One and Same declaration wording approved by the MD (1 Nov 2026). Placeholders are filled from the student record. */
export const ONE_AND_SAME_TEMPLATES = [
  { name: 'One and Same declaration', approved: true,
    body: 'I declare that {{passport_name}}, the name in my passport, and {{certificate_name}}, the name in my {{document}}, refer to one and the same person, namely me.\n\nName: {{student_name}}\nDate: {{date}}' },
]

export const BONAFIDE_RULES = [
  { name: 'Bonafide – Indian student at a Qatar school → Medical University – Varna (Bulgaria)', previousEducation: 'QA', destination: 'BG', nationality: 'IN',
    university: 'Medical University – Varna',
    description: 'Wording supplied by the MD (Oct 2026) for an Indian national at a school in Qatar applying to Varna. Approved by the MD on 1 Nov 2026.',
    approved: true,
    requirements: [
      ['statement', 'States that she/he is eligible to apply and continue her/his studies at various institutions and universities in India, Qatar as well as abroad.', true, []],
      ['keywords', 'Key words of the eligibility statement', true, ['eligible', 'continue', 'studies', 'institutions', 'universities', 'India', 'Qatar', 'abroad']],
    ] as [string, string, boolean, string[]][] },
]
