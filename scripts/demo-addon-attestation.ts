/**
 * ADD-ON for an existing demo database (no reset): adds attestation authorities, the [TO CONFIRM] demo routes,
 * and 4 NEW fictional demo students going to Bulgaria/Egypt with approved documents and attestations in progress.
 * Only inserts; never changes or deletes existing records. Local databases only.
 *   npm run demo:attestation
 */
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { getStorage, newStorageKey, sha256 } from '../src/server/storage'
import { isLocalDatabase, loadEnv, requireEnv } from './lib/env'
import { demoAttestationRoutes, demoStartAttestations } from './lib/demo-attestation'
import { placeholderPdf } from './lib/seed-demo'

loadEnv()
const url = requireEnv('DATABASE_ADMIN_URL')
if (!isLocalDatabase(url) || process.env.NODE_ENV === 'production') { console.error('Demo add-ons run on local databases only.'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
const as = <T,>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
  sql.begin(async (tx) => { await tx`select set_config('app.user_id', ${userId}, true)`; return fn(tx) }) as Promise<T>
try {
  const user = async (email: string) => (await sql<{ id: string }[]>`select id from user_profiles where email = ${email}`)[0]?.id
  const md = await user('md@demo.test')
  if (!md) throw new Error('Demo users not found – this add-on is for the demo database.')
  const countries = Object.fromEntries((await sql<{ id: string; code: string }[]>`select id, code from countries`).map((c) => [c.code, c.id]))
  if (!(await demoAttestationRoutes(sql, md, countries))) { console.log('Attestation demo already present – nothing added.'); process.exit(0) }

  const orgs = Object.fromEntries((await sql<{ id: string; code: string }[]>`select id, code from organizations`).map((o) => [o.code, o.id]))
  const mbbs = (await sql<{ id: string }[]>`select id from courses where code = 'MBBS'`)[0].id
  const uni = async (cc: string, name: string, city: string) =>
    (await sql<{ id: string }[]>`insert into universities (country_id, name, city) values (${countries[cc]}, ${name}, ${city})
                                 on conflict (country_id, name) do update set city = excluded.city returning id`)[0].id
  const unis = { BG: await uni('BG', 'Varna Medical University (Demo)', 'Varna'), EG: await uni('EG', 'Nile Medical Faculty (Demo)', 'Cairo') }
  const people = [
    { name: 'Bulgaria Indiaeducated (Demo)', org: 'EDX', dest: 'BG', edu: 'IN', counsellor: 'edx.counsellor@demo.test' },
    { name: 'Bulgaria Uaeeducated (Demo)', org: 'GRD', dest: 'BG', edu: 'AE', counsellor: 'grd.counsellor@demo.test' },
    { name: 'Egypt Indiaeducated (Demo)', org: 'EDX', dest: 'EG', edu: 'IN', counsellor: 'edx.counsellor2@demo.test' },
    { name: 'Bulgaria Secondindia (Demo)', org: 'EDX', dest: 'BG', edu: 'IN', counsellor: 'edx.counsellor@demo.test' },
  ]
  const storage = await getStorage()
  const docsUser = await user('docs@demo.test')
  const manager = await user('edx.manager@demo.test')
  const ids: string[] = []
  for (const [i, p] of people.entries()) {
    const id = randomUUID()
    const c = await user(p.counsellor)
    await as(c, (tx) => tx`insert into students (id, originating_org_id, processing_org_id, full_name, phone, email, destination_country_id, course_id,
        preferred_university_id, previous_education_country_id, visa_application_country_id, registration_date, is_demo, created_by)
      values (${id}, ${orgs[p.org]}, ${p.org === 'GRD' ? orgs.EDX : null}, ${p.name}, ${'+91 90090 ' + String(10000 + i * 111)}, ${'attest.demo' + i + '@example.test'},
              ${countries[p.dest]}, ${mbbs}, ${unis[p.dest as 'BG' | 'EG']}, ${countries[p.edu]}, ${countries[p.edu]}, current_date - 30, true, ${c})`)
    await as(manager, (tx) => tx`insert into student_assignments (student_id, user_id, org_id, assignment_type, assigned_by)
                                 values (${id}, ${docsUser}, ${orgs.EDX}, 'documentation', ${manager})`)
    const docs = await sql<{ id: string; key: string; name: string }[]>`
      select d.id, t.key, t.name from student_documents d join document_types t on t.id = d.document_type_id
       where d.student_id = ${id} and t.key in ('plus_two_certificate', 'tenth_certificate', 'birth_certificate')`
    for (const d of docs) {
      const buf = placeholderPdf(`${d.name} (attestation demo)`)
      const key = newStorageKey(orgs[p.org], id)
      await storage.put(key, buf, 'application/pdf')
      await as(docsUser, (tx) => tx`select app.register_document_file(${d.id}, ${key}, ${d.key + '.pdf'}, 'application/pdf', ${buf.length}, ${sha256(buf)})`)
      for (const q of await as(docsUser, (tx) => tx<{ requirement_id: string }[]>`select requirement_id from app.unmet_requirements(${d.id})`)) {
        await as(docsUser, (tx) => tx`select app.record_verification(${d.id}, ${q.requirement_id}, 'present', null, null)`)
      }
      await as(docsUser, (tx) => tx`select app.document_action(${d.id}, 'verify', null)`)
      await as(docsUser, (tx) => tx`select app.document_action(${d.id}, 'submit', null)`)
      await as(manager, (tx) => tx`select app.document_action(${d.id}, 'approve', null)`)
      await sql`update student_documents set issuing_country_id = ${countries[p.edu]} where id = ${d.id}`
    }
    ids.push(id)
  }
  const n = await demoStartAttestations(sql, ids.slice(0, 3), () => docsUser) // 4th student: approved documents ready to start
  console.log(`Added: attestation authorities, 3 [TO CONFIRM] routes, ${people.length} fictional demo students, ${n} attestations in progress.`)
} finally {
  await sql.end()
}
