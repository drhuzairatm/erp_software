/**
 * ADD-ON for an existing demo database (no reset): demo One and Same rule/template and fictional Plus Two records
 * for demo students that have none. Only inserts (and records demo passport holder names as new passport versions).
 * Local databases only.   npm run demo:academic
 */
import postgres from 'postgres'
import { isLocalDatabase, loadEnv, requireEnv } from './lib/env'
import { demoAcademicConfig, demoAcademicRecords } from './lib/demo-academic'

loadEnv()
const url = requireEnv('DATABASE_ADMIN_URL')
if (!isLocalDatabase(url) || process.env.NODE_ENV === 'production') { console.error('Demo add-ons run on local databases only.'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
try {
  const [md] = await sql<{ id: string }[]>`select id from user_profiles where email = 'md@demo.test'`
  if (!md) throw new Error('Demo users not found – this add-on is for the demo database.')
  const countries = Object.fromEntries((await sql<{ id: string; code: string }[]>`select id, code from countries`).map((c) => [c.code, c.id]))
  await demoAcademicConfig(sql, md.id)
  const students = await sql<{ id: string; country: string }[]>`
    select s.id, coalesce(c.code, '') as country from students s left join countries c on c.id = s.destination_country_id
     where s.is_demo and s.status in ('active', 'on_hold') order by s.created_at`
  const n = await demoAcademicRecords(sql, students, countries,
    async (id) => (await sql<{ user_id: string }[]>`
      select coalesce((select user_id from student_assignments where student_id = ${id} and is_active and assignment_type = 'counsellor' limit 1),
                      (select m.user_id from students s join organization_memberships m on m.org_id = s.originating_org_id and m.is_active
                         join roles r on r.id = m.role_id and r.key = 'manager' where s.id = ${id} limit 1)) as user_id`)[0]?.user_id ?? null)
  console.log(`Added: demo One and Same rule and template (if missing), ${n} fictional academic records.`)
} finally {
  await sql.end()
}
