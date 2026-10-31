/**
 * FICTIONAL demo data for development, testing and staff training.
 * All names, phone numbers (+91 90000 xxxxx), and emails (@example.test /
 * @demo.test) are invented. Files are generated placeholder PDFs.
 */
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { hashPassword } from '../../src/server/auth/password'
import { getStorage, newStorageKey, sha256 } from '../../src/server/storage'
import { demoAttestationRoutes, demoStartAttestations } from './demo-attestation'

type Sql = postgres.Sql

export const DEMO_USERS = [
  { email: 'md@demo.test', name: 'Meera Menon (Demo MD)', title: 'Managing Director', roles: { EDX: 'md', GRD: 'md' } },
  { email: 'ceo@demo.test', name: 'Kavya Raman (Demo CEO)', title: 'Chief Executive Officer', roles: { EDX: 'ceo', GRD: 'ceo' } },
  { email: 'admin@demo.test', name: 'Arun Pillai (Demo Admin)', title: 'System Administrator', roles: { EDX: 'system_admin', GRD: 'system_admin' } },
  { email: 'edx.manager@demo.test', name: 'Rahul Nair (Demo)', title: 'Operations Manager', roles: { EDX: 'manager' } },
  { email: 'grd.manager@demo.test', name: 'Sana Rafeeq (Demo)', title: 'Sales Manager', roles: { GRD: 'manager' } },
  { email: 'edx.counsellor@demo.test', name: 'Anjali Varma (Demo)', title: 'Counsellor', roles: { EDX: 'counsellor' } },
  { email: 'edx.counsellor2@demo.test', name: 'Vivek Kurian (Demo)', title: 'Counsellor', roles: { EDX: 'counsellor' } },
  { email: 'grd.counsellor@demo.test', name: 'Farhan Ali (Demo)', title: 'Counsellor', roles: { GRD: 'counsellor' } },
  { email: 'grd.counsellor2@demo.test', name: 'Nisha Joseph (Demo)', title: 'Counsellor', roles: { GRD: 'counsellor' } },
  { email: 'docs@demo.test', name: 'Joseph Mathew (Demo)', title: 'Documentation Executive', roles: { EDX: 'documentation' } },
  { email: 'docs2@demo.test', name: 'Reshma Das (Demo)', title: 'Documentation Executive', roles: { EDX: 'documentation' } },
  { email: 'visa@demo.test', name: 'Priya Suresh (Demo)', title: 'Visa Coordinator', roles: { EDX: 'visa' } },
  { email: 'edx.finance@demo.test', name: 'Thomas George (Demo)', title: 'Accounts Executive', roles: { EDX: 'finance' } },
  { email: 'edx.finance2@demo.test', name: 'Lakshmi Iyer (Demo)', title: 'Accounts Manager', roles: { EDX: 'finance' } },
  { email: 'grd.finance@demo.test', name: 'Imran Khan (Demo)', title: 'Accounts Executive', roles: { GRD: 'finance' } },
  { email: 'grd.finance2@demo.test', name: 'Divya Ramesh (Demo)', title: 'Accounts Manager', roles: { GRD: 'finance' } },
] as const

const FIRST = ['Aarav', 'Diya', 'Aditya', 'Fathima', 'Rohan', 'Ananya', 'Kiran', 'Sneha', 'Arjun', 'Meenakshi', 'Nikhil', 'Aisha',
  'Varun', 'Gayathri', 'Adil', 'Keerthana', 'Sachin', 'Riya', 'Abhinav', 'Hiba', 'Manu', 'Devika', 'Jithin', 'Neha', 'Akhil',
  'Shreya', 'Rizwan', 'Amrutha', 'Tejas', 'Swathi', 'Harish', 'Nandana', 'Yusuf', 'Pooja', 'Kevin', 'Lekha']
const LAST = ['Testkumar', 'Samplenath', 'Fictionraj', 'Demoyan', 'Placeholder', 'Exampleson']

// Deterministic pseudo-random generator so the demo data is the same each time.
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}
function daysFromNow(n: number) {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + n)
  return isoDate(d)
}

export function placeholderPdf(title: string, lines: string[] = []): Buffer {
  const esc = (t: string) => t.replace(/[()\\]/g, '')
  const text = `FICTIONAL DEMO DOCUMENT - ${esc(title)}`
  const body = lines.map((l, i) => `BT /F1 12 Tf 40 ${720 - i * 20} Td (${esc(l)}) Tj ET`).join(' ')
  const stream = `BT /F1 14 Tf 40 760 Td (${text}) Tj ET ${body}`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

async function as<T>(sql: Sql, userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`
    return fn(tx)
  }) as Promise<T>
}

export async function seedDemo(adminUrl: string, demoPassword: string, log: (m: string) => void = console.log) {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} })
  const storage = await getStorage()
  const rand = rng(20261031)
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]
  try {
    const already = await sql`select 1 from students where is_demo limit 1`
    if (already.length) {
      log('Demo data already present – skipping. Use `npm run db:reset` to start fresh.')
      return
    }
    const orgs = Object.fromEntries((await sql<{ id: string; code: string }[]>`select id, code from organizations`).map((o) => [o.code, o.id]))
    if (!orgs.EDX || !orgs.GRD) throw new Error('Run provisioning first (organizations missing).')
    const roleId = async (org: string, key: string) =>
      (await sql<{ id: string }[]>`select id from roles where org_id = ${orgs[org]} and key = ${key}`)[0].id

    // --- Users -------------------------------------------------------------
    const pw = await hashPassword(demoPassword)
    const users: Record<string, string> = {}
    for (const u of DEMO_USERS) {
      const id = randomUUID()
      await sql`insert into user_profiles (id, email, full_name, job_title) values (${id}, ${u.email}, ${u.name}, ${u.title})`
      await sql`insert into auth_private.credentials (user_id, password_hash) values (${id}, ${pw})`
      for (const [org, role] of Object.entries(u.roles)) {
        await sql`insert into organization_memberships (user_id, org_id, role_id) values (${id}, ${orgs[org]}, ${await roleId(org, role)})`
      }
      users[u.email] = id
    }
    const U = (e: string) => users[e]
    // Departments for demo staff
    const DEPT: Record<string, string> = { md: 'Management', ceo: 'Management', manager: 'Management', counsellor: 'Admissions',
      documentation: 'Documentation', visa: 'Visa', finance: 'Accounts' }
    await sql`update organization_memberships m set department_id = d.id
                from roles r, departments d
               where r.id = m.role_id and d.org_id = m.org_id
                 and d.name = (${sql.json(DEPT)}::jsonb ->> r.key)`

    // --- Reference data used by demo students ---------------------------------
    const countries = Object.fromEntries((await sql<{ id: string; code: string }[]>`select id, code from countries`).map((c) => [c.code, c.id]))
    const courses = Object.fromEntries((await sql<{ id: string; code: string }[]>`select id, code from courses`).map((c) => [c.code, c.id]))
    const uniDefs: [string, string, string][] = [
      ['RU', 'Volga State Medical University (Demo)', 'Kazan'], ['RU', 'Northern Federal Medical Academy (Demo)', 'Arkhangelsk'],
      ['GE', 'Tbilisi International Medical School (Demo)', 'Tbilisi'], ['GE', 'Black Sea Medical University (Demo)', 'Batumi'],
      ['KZ', 'Steppe National Medical University (Demo)', 'Almaty'], ['UZ', 'Silk Road Medical Institute (Demo)', 'Samarkand'],
      ['DE', 'Rhein Nursing College (Demo)', 'Cologne'], ['PH', 'Pacific Medical College (Demo)', 'Cebu'],
      ['BG', 'Varna Medical University (Demo)', 'Varna'], ['BG', 'Pleven Medical University (Demo)', 'Pleven'], ['EG', 'Nile Medical Faculty (Demo)', 'Cairo'],
    ]
    const unis: Record<string, string[]> = {}
    for (const [cc, name, city] of uniDefs) {
      const [u] = await sql<{ id: string }[]>`insert into universities (country_id, name, city) values (${countries[cc]}, ${name}, ${city})
                                              on conflict (country_id, name) do update set city = excluded.city returning id`
      ;(unis[cc] ??= []).push(u.id)
    }
    // University configuration (fictional): campuses, courses, intakes, a university-specific document rule
    const docType = async (key: string) => (await sql<{ id: string }[]>`select id from document_types where key = ${key}`)[0].id
    for (const [cc, ids] of Object.entries(unis)) {
      for (const [k, uid] of ids.entries()) {
        await sql`insert into university_campuses (university_id, name, city) values (${uid}, 'Main campus', null) on conflict do nothing`
        if (k === 0) await sql`insert into university_campuses (university_id, name) values (${uid}, 'City clinical campus') on conflict do nothing`
        const course = cc === 'DE' ? courses.NURSING : courses.MBBS
        await sql`insert into university_courses (university_id, course_id, duration_years, medium, eligibility)
                  values (${uid}, ${course}, ${cc === 'DE' ? 3 : 6}, 'English',
                          ${cc === 'DE' ? 'B.Sc Nursing or GNM; German B1 (fictional rule)' : 'Plus Two with 50% in Physics, Chemistry, Biology; NEET qualified (fictional rule)'})
                  on conflict do nothing`
        await sql`insert into university_intakes (university_id, course_id, name, application_deadline, starts_on)
                  values (${uid}, ${course}, 'September 2027', ${daysFromNow(60 + k * 20)}, ${daysFromNow(300)})`
      }
    }
    // Example university-specific requirement: the first Russian university also wants a bank statement
    await sql`insert into university_document_requirements (university_id, document_type_id, is_required, notes)
              values (${unis.RU[0]}, ${await docType('bank_statement')}, true, 'Sponsor bank statement (fictional example rule)')`

    const leadSources = async (org: string) => (await sql<{ id: string }[]>`select id from lead_sources where org_id = ${orgs[org]}`).map((r) => r.id)
    const sources = { EDX: await leadSources('EDX'), GRD: await leadSources('GRD') }
    const fee = async (org: string, key: string) => (await sql<{ id: string }[]>`select id from fee_categories where org_id = ${orgs[org]} and key = ${key}`)[0].id
    const [entity1] = await sql<{ id: string }[]>`insert into legal_entities (name, notes) values ('Demo Legal Entity A (fictional)', 'Placeholder – legal structure to be confirmed') on conflict (name) do update set notes = excluded.notes returning id`
    const [entity2] = await sql<{ id: string }[]>`insert into legal_entities (name, notes) values ('Demo Legal Entity B (fictional)', 'Placeholder – legal structure to be confirmed') on conflict (name) do update set notes = excluded.notes returning id`

    // --- Students ------------------------------------------------------------
    type Plan = { org: 'EDX' | 'GRD'; country: string; course: string; target: number | 'hold' | 'cancelled' }
    const plans: Plan[] = []
    const combos: [string, string][] = [['BG', 'MBBS'], ['GE', 'MBBS'], ['EG', 'MBBS'], ['UZ', 'MBBS'], ['BG', 'NURSING'], ['PH', 'MBBS'], ['RU', 'MBBS'], ['KZ', 'MBBS']]
    for (let i = 0; i < 36; i++) {
      const [country, course] = combos[i % combos.length]
      const target: Plan['target'] = i % 17 === 5 ? 'hold' : i % 19 === 7 ? 'cancelled' : i % 12
      plans.push({ org: i % 9 < 5 ? 'EDX' : 'GRD', country, course, target })
    }

    const counsellors = { EDX: ['edx.counsellor@demo.test', 'edx.counsellor2@demo.test'], GRD: ['grd.counsellor@demo.test', 'grd.counsellor2@demo.test'] }
    const managers = { EDX: 'edx.manager@demo.test', GRD: 'grd.manager@demo.test' }
    const financeA = { EDX: 'edx.finance@demo.test', GRD: 'grd.finance@demo.test' }
    const financeB = { EDX: 'edx.finance2@demo.test', GRD: 'grd.finance2@demo.test' }
    const docsStaff = ['docs@demo.test', 'docs2@demo.test']
    const created: { id: string; plan: Plan; code: string; counsellor: string }[] = []

    for (let i = 0; i < plans.length; i++) {
      const p = plans[i]
      const counsellor = counsellors[p.org][i % 2]
      const first = FIRST[i % FIRST.length]
      const last = LAST[i % LAST.length]
      const id = randomUUID()
      const phone = `+91 90000 ${String(10000 + i * 37).padStart(5, '0')}`
      const registeredDaysAgo = 5 + Math.floor(rand() * 150)
      const eduCountry = i % 7 === 3 ? 'QA' : i % 7 === 5 ? 'AE' : i % 11 === 6 ? 'SA' : 'IN'
      await as(sql, U(counsellor), async (tx) => {
        await tx`insert into students (id, originating_org_id, processing_org_id, lead_source_id, full_name, phone, email,
                   preferred_language, destination_country_id, course_id, preferred_university_id, highest_qualification,
                   qualification_board, qualification_year, qualification_score, entrance_exam, entrance_score,
                   registration_date, next_action, next_action_due, contracting_entity_id, payment_recipient_entity_id, is_demo, created_by,
                   previous_education_country_id, institution_name, passport_number, passport_expiry, passport_country_id, visa_application_country_id,
                   phone_country, phone2, phone2_country)
                 values (${id}, ${orgs[p.org]}, ${p.org === 'GRD' ? orgs.EDX : null}, ${pick(sources[p.org])},
                   ${`${first} ${last}`}, ${phone}, ${`${first.toLowerCase()}.${i}@example.test`},
                   ${pick(['English', 'Malayalam', 'Hindi', 'Tamil', 'Arabic'])}, ${countries[p.country]}, ${courses[p.course]},
                   ${pick(unis[p.country])}, ${p.course === 'NURSING' ? 'B.Sc Nursing' : 'Plus Two (Science)'},
                   ${pick(['CBSE', 'State Board', 'ICSE'])}, ${2023 + Math.floor(rand() * 3)}, ${`${70 + Math.floor(rand() * 28)}%`},
                   ${p.course === 'NURSING' ? 'German A2' : 'NEET-UG (fictional)'}, ${p.course === 'NURSING' ? 'Pass' : String(300 + Math.floor(rand() * 300))},
                   ${daysFromNow(-registeredDaysAgo)}, ${'Call student to confirm next step'}, ${daysFromNow(Math.floor(rand() * 10) - 4)},
                   ${p.org === 'EDX' ? entity1.id : entity2.id}, ${p.org === 'EDX' ? entity1.id : entity2.id}, true, ${U(counsellor)},
                   ${countries[eduCountry]}, ${'Demo ' + (eduCountry === 'IN' ? 'Higher Secondary School' : 'International School') + ' ' + (i % 5 + 1)},
                   ${i % 3 === 2 ? null : `DM${String(1000000 + i * 7919).slice(-7)}`}, ${i % 3 === 2 ? null : daysFromNow(i % 13 === 4 ? 45 : 1500 + i * 3)},
                   ${i % 3 === 2 ? null : countries.IN}, ${['BG', 'EG'].includes(p.country) ? countries[eduCountry] : null},
                   'IN', ${'+9190020' + String(10000 + i).slice(-5)}, 'IN')`
        await tx`insert into student_assignments (student_id, user_id, org_id, assignment_type, assigned_by)
                 values (${id}, ${U(counsellor)}, ${orgs[p.org]}, 'counsellor', ${U(counsellor)})`
        await tx`select app.add_event(${id}, ${orgs[p.org]}, 'student', 'registered', ${'Student registered'})`
      })
      await sql`update students set created_at = now() - make_interval(days => ${registeredDaysAgo}) where id = ${id}`
      const [{ student_code }] = await sql<{ student_code: string }[]>`select student_code from students where id = ${id}`
      created.push({ id, plan: p, code: student_code, counsellor })
    }

    // Processing staff assignments (central processing team in EDX)
    for (const [i, s] of created.entries()) {
      if (s.plan.target === 0) continue
      await as(sql, U(managers.EDX), async (tx) => {
        await tx`insert into student_assignments (student_id, user_id, org_id, assignment_type, assigned_by)
                 values (${s.id}, ${U(docsStaff[i % 2])}, ${orgs.EDX}, 'documentation', ${U(managers.EDX)})`
        await tx`insert into student_assignments (student_id, user_id, org_id, assignment_type, assigned_by)
                 values (${s.id}, ${U(managers.EDX)}, ${orgs.EDX}, 'manager', ${U(managers.EDX)})`
        if (typeof s.plan.target === 'number' && s.plan.target >= 6) {
          await tx`insert into student_assignments (student_id, user_id, org_id, assignment_type, assigned_by)
                   values (${s.id}, ${U('visa@demo.test')}, ${orgs.EDX}, 'visa', ${U(managers.EDX)})`
        }
      })
    }

    // --- Stage progression via the real workflow function --------------------
    for (const s of created) {
      const stages = (await sql<{ stage_key: string }[]>`
        select ws.stage_key from students st join workflow_stages ws on ws.workflow_id = st.workflow_id
         where st.id = ${s.id} order by ws.sort_order`).map((r) => r.stage_key)
      const target = s.plan.target
      const upTo = typeof target === 'number' ? Math.min(target, stages.length - 1) : 3
      for (let k = 1; k <= upTo; k++) {
        const stage = stages[k]
        const actor = stage === 'fee_clearance' ? financeA[s.plan.org] : managers[s.plan.org]
        if (stage === 'travel_preparation' || stage === 'travel_completed') {
          await as(sql, U('visa@demo.test'), (tx) => tx`select app.update_visa_details(${s.id}, ${daysFromNow(-20)}, 'approved', 'VISA-DEMO-' || ${s.code})`)
        }
        if (stage === 'visa_processing') {
          await as(sql, U(managers.EDX), (tx) => tx`select app.update_admission_details(${s.id}, ${'APP-DEMO-' + s.code}, ${daysFromNow(-30)})`)
        }
        await as(sql, U(actor), (tx) => tx`select app.change_student_stage(${s.id}, ${stage}, null, ${'Continue with ' + stage.replace(/_/g, ' ')}, ${daysFromNow(Math.floor(rand() * 14) - 5)}, '[]'::jsonb)`)
      }
      if (target === 'hold') {
        await as(sql, U(managers[s.plan.org]), (tx) => tx`select app.change_student_stage(${s.id}, 'on_hold', 'Student requested a pause for family reasons (demo)', 'Check back with student', ${daysFromNow(7)}, '[]'::jsonb)`)
      }
      if (target === 'cancelled') {
        await as(sql, U(managers[s.plan.org]), (tx) => tx`select app.change_student_stage(${s.id}, 'cancelled', 'Student chose a different programme (demo)', null, null, '[]'::jsonb)`)
      }
      // spread stage history over time
      await sql`update student_stage_history h set changed_at = st.created_at + (now() - st.created_at) * (r.rn::numeric / (r.n + 1))
                  from (select id, row_number() over (order by changed_at, id) as rn, count(*) over () as n
                          from student_stage_history where student_id = ${s.id}) r,
                       students st
                 where h.id = r.id and st.id = h.student_id`
      await sql`update students st set stage_changed_at = coalesce((select max(changed_at) from student_stage_history where student_id = st.id), st.created_at)
                 where id = ${s.id}`
    }

    // --- Verification rules: PLACEHOLDER wording (to be replaced by the business), approved by the demo MD ---
    const docTypeId = async (key: string) => (await sql<{ id: string }[]>`select id from document_types where key = ${key}`)[0].id
    const rule = async (name: string, docKey: string, prevCountry: string | null, reqs: [string, string, boolean, string[]?][]) => {
      const [r] = await sql<{ id: string }[]>`insert into verification_rules (name, description, document_type_id, previous_education_country_id, created_by)
        values (${name}, 'Example wording for testing only — replace with the wording approved by the MD.', ${await docTypeId(docKey)},
                ${prevCountry ? countries[prevCountry] : null}, ${U('md@demo.test')}) returning id`
      for (const [k, [kind, text, mandatory, keywords]] of reqs.entries()) {
        await sql`insert into verification_requirements (rule_id, sort_order, kind, text, keywords, is_mandatory)
                  values (${r.id}, ${(k + 1) * 10}, ${kind}, ${text}, ${sql.array(keywords ?? [])}::text[], ${mandatory})`
      }
      await as(sql, U('md@demo.test'), (tx) => tx`select app.approve_verification_rule(${r.id})`)
    }
    const BONAFIDE: Record<string, string> = {
      IN: 'eligible to pursue higher education in India and abroad',
      QA: 'eligible to pursue higher education in Qatar and abroad',
      AE: 'eligible to pursue higher education in UAE and abroad',
    }
    for (const [cc, phrase] of Object.entries(BONAFIDE)) {
      await rule(`[PLACEHOLDER] Bonafide certificate – educated in ${cc === 'IN' ? 'India' : cc === 'QA' ? 'Qatar' : 'UAE'}`, 'bonafide_certificate', cc, [
        ['exact_phrase', phrase, true],
        ['manual_check', 'Signed by the head of the institution with the official seal', true],
        ['keywords', 'Identifies the student', false, ['bonafide', 'student']],
      ])
    }
    await rule('[PLACEHOLDER] Passport – basic checks', 'passport', null, [
      ['manual_check', 'Name and date of birth match the student record', true],
      ['manual_check', 'Valid for at least 18 months from the intended travel date', true],
    ])
    await rule('[PLACEHOLDER] Plus Two certificate', 'plus_two_certificate', null, [
      ['manual_check', 'Marks statement and board seal are clearly visible', true],
    ])
    const eduOf = new Map<string, string>()
    for (const r of await sql<{ id: string; code: string | null }[]>`select s.id, c.code from students s left join countries c on c.id = s.previous_education_country_id`) eduOf.set(r.id, r.code ?? 'IN')

    // Document workflow helpers (real functions: verify → submit → approval by a different person)
    const verifyAll = async (docId: string, reviewer: string) => {
      const unmet = await as(sql, U(reviewer), (tx) => tx<{ requirement_id: string }[]>`select requirement_id from app.unmet_requirements(${docId})`)
      for (const q of unmet) await as(sql, U(reviewer), (tx) => tx`select app.record_verification(${docId}, ${q.requirement_id}, 'present', null, null)`)
      await as(sql, U(reviewer), (tx) => tx`select app.document_action(${docId}, 'verify', null)`)
    }
    const act = (docId: string, user: string, action: string, reason: string | null = null) =>
      as(sql, U(user), (tx) => tx`select app.document_action(${docId}, ${action}, ${reason})`)

    // --- Documents -------------------------------------------------------------
    let fileCount = 0
    for (const [i, s] of created.entries()) {
      const stageIndex = typeof s.plan.target === 'number' ? s.plan.target : 3
      if (stageIndex < 2) continue
      const docs = await sql<{ id: string; key: string; name: string }[]>`
        select d.id, t.key, t.name from student_documents d join document_types t on t.id = d.document_type_id
         where d.student_id = ${s.id} order by t.sort_order`
      const reviewer = docsStaff[i % 2]
      for (const [j, d] of docs.entries()) {
        const uploadShare = stageIndex >= 4 ? 1 : 0.6
        if (rand() > uploadShare) continue
        const edu = eduOf.get(s.id) ?? 'IN'
        const lines = d.key === 'bonafide_certificate'
          ? ['This is to certify that the student named above is a bonafide student of this institution', `and is ${BONAFIDE[edu] ?? BONAFIDE.IN}.`, 'Principal (signature and seal - fictional)']
          : []
        const buf = placeholderPdf(`${d.name} for ${s.code}`, lines)
        const key = newStorageKey(orgs[s.plan.org], s.id)
        await storage.put(key, buf, 'application/pdf')
        fileCount++
        const uploader = s.plan.org === 'GRD' && j % 2 ? s.counsellor : reviewer
        await as(sql, U(uploader), (tx) => tx`select app.register_document_file(${d.id}, ${key}, ${d.key + '.pdf'}, 'application/pdf', ${buf.length}, ${sha256(buf)})`)
        const roll = rand()
        const approver = managers.EDX // central processing manager approves (never the verifier)
        if (stageIndex >= 4 || roll < 0.5) {
          await verifyAll(d.id, reviewer)
          await act(d.id, reviewer, 'submit')
          await act(d.id, approver, 'approve')
          if (d.key === 'passport') {
            await sql`update student_documents set expiry_date = ${i % 11 === 3 ? daysFromNow(-10) : daysFromNow(900 + i)} where id = ${d.id}`
            if (i % 11 === 3) await act(d.id, reviewer, 'expire', 'Passport expired – renewal needed')
          }
        } else if (roll < 0.6) {
          await verifyAll(d.id, reviewer)
          await act(d.id, reviewer, 'submit') // awaiting manager approval
        } else if (roll < 0.7) {
          await act(d.id, reviewer, 'request_changes', pick(['Scan is blurred – please resubmit', 'Photo background is not white', 'Page missing']))
        } else if (roll < 0.78) {
          await act(d.id, reviewer, 'reject', pick(['Name mismatch with passport', 'Wrong document uploaded']))
        } else if (roll < 0.9) {
          await act(d.id, reviewer, 'start_review')
        }
        if (['tenth_certificate', 'plus_two_certificate'].includes(d.key) && stageIndex >= 4) {
          await as(sql, U(reviewer), (tx) => tx`select app.record_document_custody(${d.id}, ${pick(['with_staff', 'with_provider', 'at_embassy', 'returned_to_student'])}, 'Demo custody record', ${'TRK-DEMO-' + String(1000 + i * 10 + j)})`)
        }
      }
    }

    for (const c of created) {
      await sql`update student_documents d set issuing_country_id = s.previous_education_country_id from students s
                 where s.id = d.student_id and d.student_id = ${c.id} and s.previous_education_country_id is not null`
    }

    await demoAttestationRoutes(sql, U('md@demo.test'), countries)

    // Start attestation for some approved documents of Bulgaria/Egypt students; advance a few stages
    const attCount = await demoStartAttestations(sql, created.filter((c) => ['BG', 'EG'].includes(c.plan.country)).map((c) => c.id),
      (i) => U(docsStaff[i % 2]))

    // --- Tasks --------------------------------------------------------------
    const delayReasons = ['student', 'university', 'embassy', 'provider', 'finance', 'other_external']
    let taskCount = 0
    for (const [i, s] of created.entries()) {
      const stageIndex = typeof s.plan.target === 'number' ? s.plan.target : 3
      const defs: { title: string; type: string; assignee: string; org: 'EDX' | 'GRD'; due: number; status: string; delay?: string }[] = [
        { title: 'Follow-up call with student and parents', type: 'followup', assignee: s.counsellor, org: s.plan.org, due: (i % 7) - 3,
          status: i % 5 === 0 ? 'completed' : i % 3 === 0 ? 'in_progress' : 'not_started' },
      ]
      if (stageIndex >= 2) defs.push({ title: 'Collect pending original certificates', type: 'documentation', assignee: docsStaff[i % 2], org: 'EDX', due: (i % 9) - 5,
        status: i % 4 === 0 ? 'waiting_external' : i % 4 === 1 ? 'completed' : 'in_progress', delay: 'student' })
      if (stageIndex >= 4) defs.push({ title: 'Submit documents for attestation / apostille', type: 'attestation', assignee: docsStaff[i % 2], org: 'EDX', due: (i % 6) - 2,
        status: i % 3 === 0 ? 'waiting_external' : 'completed', delay: pick(delayReasons) })
      if (stageIndex >= 8) defs.push({ title: 'Book visa appointment', type: 'visa', assignee: 'visa@demo.test', org: 'EDX', due: (i % 5) - 1,
        status: i % 2 ? 'waiting_external' : 'not_started', delay: 'embassy' })
      if (i % 6 === 2) defs.push({ title: 'Prepare fee reminder', type: 'finance', assignee: financeA[s.plan.org], org: s.plan.org, due: 2, status: 'not_started' })
      for (const t of defs) {
        const tid = randomUUID()
        await as(sql, U(t.org === 'EDX' ? managers.EDX : managers.GRD), (tx) => tx`
          insert into tasks (id, org_id, student_id, title, task_type, assigned_to, priority, status, due_date, delay_reason)
          values (${tid}, ${orgs[t.org]}, ${s.id}, ${t.title}, ${t.type}, ${U(t.assignee)}, ${pick(['normal', 'normal', 'high', 'low', 'urgent'])},
                  'not_started', ${daysFromNow(t.due)}, null)`)
        if (t.status !== 'not_started') {
          await as(sql, U(t.assignee), (tx) => tx`update tasks set status = ${t.status},
                     delay_reason = ${t.status === 'waiting_external' ? (t.delay ?? 'other_external') : null} where id = ${tid}`)
        }
        await sql`update tasks set created_at = now() - make_interval(days => ${10 + (i % 20)}),
                    completed_at = case when status = 'completed' then (due_date::timestamptz + make_interval(days => ${(i % 4) - 2})) end
                   where id = ${tid}`
        taskCount++
      }
    }

    // --- Payments -----------------------------------------------------------
    let payCount = 0
    for (const [i, s] of created.entries()) {
      const stageIndex = typeof s.plan.target === 'number' ? s.plan.target : 3
      if (stageIndex < 1) continue
      const o = s.plan.org
      const rec = async (actor: string, type: string, cat: string, amount: number, extra: { method?: string; ref?: string; payee?: string } = {}) => {
        const pid = randomUUID()
        const feeId = await fee(o, cat)
        await as(sql, U(actor), (tx) => tx`
          insert into payment_entries (id, org_id, student_id, entry_type, fee_category_id, amount, entry_date, method, reference_no, payee, recipient_entity_id)
          values (${pid}, ${orgs[o]}, ${s.id}, ${type}, ${feeId}, ${amount}, ${daysFromNow(-(i % 40))},
                  ${extra.method ?? null}, ${extra.ref ?? null}, ${extra.payee ?? null}, ${o === 'EDX' ? entity1.id : entity2.id})`)
        payCount++
        return pid
      }
      const verify = (pid: string, decision = 'verified', note: string | null = null) =>
        as(sql, U(financeB[o]), (tx) => tx`select app.verify_payment(${pid}, ${decision}, ${note})`)
      await rec(financeA[o], 'charge', 'registration_fee', 25000)
      const r1 = await rec(financeA[o], 'receipt', 'registration_fee', i % 4 === 0 ? 15000 : 25000, { method: pick(['upi', 'bank_transfer', 'cash']), ref: `DEMO-UTR-${100000 + i}` })
      if (i % 5 !== 1) await verify(r1)
      if (stageIndex >= 3) {
        await rec(financeA[o], 'charge', 'service_fee', 150000)
        const r2 = await rec(financeA[o], 'receipt', 'service_fee', i % 3 === 0 ? 50000 : 150000, { method: 'bank_transfer', ref: `DEMO-NEFT-${200000 + i}` })
        if (i % 7 === 3) await verify(r2, 'rejected', 'Reference number not found in bank statement (demo)')
        else if (i % 4 !== 2) await verify(r2)
      }
      if (stageIndex >= 7) {
        await rec(financeA[o], 'charge', 'university_fee', 400000)
        const r3 = await rec(financeA[o], 'receipt', 'university_fee', 400000, { method: 'bank_transfer', ref: `DEMO-UNI-${300000 + i}` })
        await verify(r3)
        if (stageIndex >= 9) {
          const d = await rec(financeA[o], 'disbursement', 'university_fee', 400000, { method: 'bank_transfer', ref: `DEMO-SWIFT-${400000 + i}`, payee: 'University (demo)' })
          await verify(d)
        }
      }
      if (i === 8) {
        // a corrected mistake: wrong charge reversed
        const wrong = await rec(financeA[o], 'charge', 'documentation_fee', 12000)
        const rev = randomUUID()
        const docFee = await fee(o, 'documentation_fee')
        await as(sql, U(financeA[o]), (tx) => tx`
          insert into payment_entries (id, org_id, student_id, entry_type, fee_category_id, amount, reverses_entry_id, notes)
          values (${rev}, ${orgs[o]}, ${s.id}, 'reversal', ${docFee}, 12000, ${wrong}, 'Charged in error (demo)')`)
        await verify(rev)
      }
    }

    // --- Notes & follow-ups -----------------------------------------------------
    for (const [i, s] of created.entries()) {
      await as(sql, U(s.counsellor), async (tx) => {
        await tx`insert into followups (student_id, org_id, channel, summary, occurred_at, next_followup_date)
                 values (${s.id}, ${orgs[s.plan.org]}, ${pick(['call', 'whatsapp', 'in_person'])},
                         ${'Discussed university options and fee structure with parent (demo).'}, now() - interval '3 days', ${daysFromNow(4)})`
        await tx`select app.add_event(${s.id}, ${orgs[s.plan.org]}, 'followup', 'followup', 'Follow-up logged (call)')`
        if (i % 3 === 0) {
          await tx`insert into student_notes (student_id, org_id, body) values (${s.id}, ${orgs[s.plan.org]}, ${'Parent prefers communication in the evening (demo).'})`
          await tx`select app.add_event(${s.id}, ${orgs[s.plan.org]}, 'note', 'note', 'Internal note added')`
        }
      })
    }

    // --- A cross-brand possible duplicate (same phone as an EDX student) ------------
    const edxStudent = created.find((c) => c.plan.org === 'EDX')!
    const [{ phone }] = await sql<{ phone: string }[]>`select phone from students where id = ${edxStudent.id}`
    const dupId = randomUUID()
    await as(sql, U('grd.counsellor@demo.test'), async (tx) => {
      await tx`insert into students (id, originating_org_id, processing_org_id, full_name, phone, email, registration_date, is_demo, created_by)
               values (${dupId}, ${orgs.GRD}, ${orgs.EDX}, ${FIRST[0] + ' ' + LAST[0]}, ${phone}, ${'dup.enquiry@example.test'}, ${daysFromNow(-2)}, true, ${U('grd.counsellor@demo.test')})`
      await tx`insert into student_assignments (student_id, user_id, org_id, assignment_type, assigned_by)
               values (${dupId}, ${U('grd.counsellor@demo.test')}, ${orgs.GRD}, 'counsellor', ${U('grd.counsellor@demo.test')})`
      await tx`select app.add_event(${dupId}, ${orgs.GRD}, 'student', 'registered', 'Student registered (possible duplicate of another brand record)')`
    })

    // --- Notifications (demo): fictional consent for most students; a few rules switched on (test mode keeps everything unsent)
    for (const [i, c] of created.entries()) {
      if (i % 4 === 3) continue
      for (const ch of ['whatsapp', 'email']) {
        await as(sql, U(managers[c.plan.org]), (tx) => tx`select app.record_consent(${c.id}, ${ch}, 'student', true, 'Demo – fictional consent')`)
      }
      if (i % 2 === 0) await as(sql, U(managers[c.plan.org]), (tx) => tx`select app.record_consent(${c.id}, 'whatsapp', 'parent', true, 'Demo – fictional consent')`)
    }
    await sql`update students set parent_name = 'Parent of ' || split_part(full_name, ' ', 1) || ' (Demo)', parent_phone = '+91 90001 ' || lpad((abs(hashtext(id::text)) % 100000)::text, 5, '0')
               where is_demo and parent_name is null`
    await sql`update notification_templates set provider_template_name = 'demo_' || lower(regexp_replace(name, '[^A-Za-z]+', '_', 'g')) where channel = 'whatsapp'`
    await sql`update notification_rules set is_enabled = true
               where audience = 'student' and event_key in ('stage_changed', 'document_changes_required', 'document_approved', 'student_registered')`
    await sql`update notification_rules set is_enabled = true where audience = 'parent' and channel = 'whatsapp' and event_key = 'stage_changed'`
    await sql`insert into notification_rules (org_id, event_key, channel, audience, template_id, is_enabled)
              select r.org_id, r.event_key, r.channel, 'parent', r.template_id, true from notification_rules r
               where r.audience = 'student' and r.channel = 'whatsapp' and r.event_key = 'stage_changed'
              on conflict do nothing`

    log(`Demo data created: ${DEMO_USERS.length} users, ${created.length + 1} students, ${fileCount} placeholder files, ${taskCount} tasks, ${payCount} ledger entries, ${attCount} attestations.`)
  } finally {
    await sql.end()
  }
}
