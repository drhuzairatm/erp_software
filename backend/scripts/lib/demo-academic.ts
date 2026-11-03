/**
 * Demo academic data (FICTIONAL). Plus Two / Class 10 records with subject marks, a few certificate names that differ
 * from the passport and demo One and Same rules.
 */
import postgres from 'postgres'

type Sql = postgres.Sql
async function as<T>(sql: Sql, userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`
    return fn(tx)
  }) as Promise<T>
}

const VARIANTS: ((n: string) => string)[] = [
  (n) => n.split(' ')[0],                                                            // surname missing
  (n) => n.split(' ').map((p, i) => (i === 0 ? p[0] : p)).join(' '),                 // initial instead of first name
  (n) => n.split(' ').reverse().join(' '),                                           // name order
  (n) => n.replace(/a/i, 'e'),                                                       // spelling
]

export async function demoAcademicConfig(sql: Sql, mdUserId: string) {
  if (!(await sql`select 1 from one_and_same_rules where name like '[DEMO]%'`).length) {
    await sql`insert into one_and_same_rules (name, mismatch_type, requirement, notes, created_by)
              values ('[DEMO] Surname missing on a certificate', 'missing_surname', 'mandatory', 'Demo rule for testing – confirm the real rules', ${mdUserId}),
                     ('[DEMO] Any other name difference', null, 'recommended', 'Demo rule for testing – confirm the real rules', ${mdUserId})`
  }
  // The One and Same wording is the approved template installed by provisioning (no demo wording any more).
}

/** Adds academic records for the given demo students (skips students that already have records). Returns the count. */
export async function demoAcademicRecords(sql: Sql, students: { id: string; country: string }[], countries: Record<string, string>, staffFor: (id: string) => Promise<string | null>) {
  let n = 0
  for (const [i, st] of students.entries()) {
    if ((await sql`select 1 from academic_records where student_id = ${st.id} limit 1`).length) continue
    const [s] = await sql<{ full_name: string; edu: string | null; course: string | null; pp: string | null }[]>`
      select s.full_name, s.previous_education_country_id as edu, c.academic_profile as course, s.passport_number as pp
        from students s left join courses c on c.id = s.course_id where s.id = ${st.id}`
    const worker = await staffFor(st.id)
    if (!worker || s.course === 'pg_medical') continue
    const low = st.country === 'BG' && i % 3 === 1 // some Bulgaria students below the 60% threshold
    const marks = { physics: 62 + (i * 7) % 30, chemistry: low ? 54 : 65 + (i * 5) % 30, biology: 70 + (i * 3) % 25, english: low ? 58 : 66 + (i * 11) % 30 }
    const certName = i % 6 === 2 ? VARIANTS[i % VARIANTS.length](s.full_name.toUpperCase()) : s.full_name.toUpperCase()
    await as(sql, worker, async (tx) => {
      const [r] = await tx<{ id: string }[]>`insert into academic_records (student_id, kind, name_on_certificate, certificate_number, register_number, board,
          institution_country_id, issuing_country_id, year_of_passing, stream, grading_system, total_marks, marks_obtained, created_by)
        values (${st.id}, 'plus_two', ${certName}, ${'DEMO-HS-' + (40000 + i)}, ${'R' + (900000 + i * 13)}, ${s.edu === countries.IN ? 'CBSE (demo)' : 'CBSE – overseas school (demo)'},
                ${s.edu}, ${s.edu}, 2025, 'Science (PCB)', 'marks', 400, ${marks.physics + marks.chemistry + marks.biology + marks.english}, ${worker}) returning id`
      for (const [k, [key, name]] of ([['physics', 'Physics'], ['chemistry', 'Chemistry'], ['biology', 'Biology'], ['english', 'English Core']] as const).entries()) {
        await tx`insert into academic_subjects (record_id, subject_key, subject_name, max_marks, marks_obtained, sort_order)
                 values (${r.id}, ${key}, ${name}, 100, ${marks[key]}, ${(k + 1) * 10})`
      }
    })
    // record the holder name as printed on the passport (fictional) for students with a passport
    if (s.pp && i % 2 === 0) {
      const [cur] = await sql<{ expiry_date: string; issuing_country_id: string | null }[]>`select expiry_date::text, issuing_country_id from student_passports where student_id = ${st.id} and is_current`
      if (cur?.expiry_date) {
        await as(sql, worker, (tx) => tx`select app.record_passport(${st.id}, 'correction', ${s.pp}, ${s.full_name.toUpperCase()}, null, null, ${countries.IN}, ${countries.IN},
                                                       ${cur.issuing_country_id}, null, ${cur.expiry_date}::date, null, 'Holder name recorded from the passport (demo)')`)
      }
    }
    n++
  }
  return n
}
