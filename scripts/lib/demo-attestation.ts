/**
 * Demo attestation configuration (FICTIONAL / TO CONFIRM). Routes follow the business brief and are
 * approved here ONLY so the demo can be tried; in production the MD enters and approves real routes.
 */
import postgres from 'postgres'

type Sql = postgres.Sql
async function as<T>(sql: Sql, userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`
    return fn(tx)
  }) as Promise<T>
}

export async function demoAttestationRoutes(sql: Sql, mdUserId: string, countries: Record<string, string>) {
  const existing = await sql`select 1 from attestation_routes where name like '[TO CONFIRM]%' limit 1`
  if (existing.length) return false
  const auth = async (name: string, cc: string, kind: string) =>
    (await sql<{ id: string }[]>`insert into attestation_authorities (name, country_id, kind) values (${name}, ${countries[cc]}, ${kind})
                                 on conflict (name, country_id) do update set kind = excluded.kind returning id`)[0].id
  const A = {
    apostilleIN: await auth('Ministry of External Affairs (MEA) – Apostille, India', 'IN', 'apostille_authority'),
    meaIN: await auth('Ministry of External Affairs (MEA) – Attestation, India', 'IN', 'foreign_affairs'),
    moeAE: await auth('UAE Ministry of Education', 'AE', 'education_ministry'),
    mofaAE: await auth('UAE Ministry of Foreign Affairs', 'AE', 'foreign_affairs'),
    bgEmbassyAE: await auth('Embassy of Bulgaria in the UAE', 'AE', 'embassy'),
    egEmbassyIN: await auth('Embassy of Egypt in India', 'IN', 'embassy'),
  }
  const route = async (name: string, type: string, dest: string, issuing: string, stages: [string, string | null, boolean, boolean][]) => {
    const [r] = await sql<{ id: string }[]>`insert into attestation_routes (name, route_type, destination_country_id, issuing_country_id, source_note, created_by)
      values (${name}, ${type}, ${countries[dest]}, ${countries[issuing]}, 'Business-supplied procedure from the brief (Oct 2026) – to be confirmed; not legal advice', ${mdUserId}) returning id`
    for (const [k, [stName, authId, mandatory, needsRef]] of stages.entries()) {
      await sql`insert into attestation_route_stages (route_id, sort_order, name, authority_id, is_mandatory, responsible_department, requires_reference, expected_days)
                values (${r.id}, ${(k + 1) * 10}, ${stName}, ${authId}, ${mandatory}, 'Attestation', ${needsRef}, 7)`
    }
    await as(sql, mdUserId, (tx) => tx`select app.approve_attestation_route(${r.id})`)
  }
  await route('[TO CONFIRM] Bulgaria – India-issued documents – Apostille', 'apostille', 'BG', 'IN', [['Apostille (India)', A.apostilleIN, true, true]])
  await route('[TO CONFIRM] Bulgaria – UAE-issued documents – Legalisation', 'legalisation', 'BG', 'AE', [
    ['UAE Ministry of Education attestation', A.moeAE, true, true], ['UAE Ministry of Foreign Affairs attestation', A.mofaAE, true, true],
    ['Bulgarian Embassy attestation (UAE)', A.bgEmbassyAE, true, true]])
  await route('[TO CONFIRM] Egypt – India-issued documents', 'legalisation', 'EG', 'IN', [
    ['Indian authentication / Apostille', A.apostilleIN, true, true], ['MEA attestation (where required)', A.meaIN, false, false],
    ['Egyptian Embassy attestation in India', A.egEmbassyIN, true, true]])
  return true
}

/** Start attestation on up to two approved documents per student; advance some stages. Returns how many started. */
export async function demoStartAttestations(sql: Sql, studentIds: string[], worker: (i: number) => string) {
  let n = 0
  for (const [i, id] of studentIds.entries()) {
    const approved = await sql<{ id: string }[]>`select d.id from student_documents d where d.student_id = ${id} and d.status = 'approved'
                                                  and d.approved_file_id = d.current_file_id order by d.created_at limit 2`
    for (const d of approved) {
      const [m] = await sql<{ route_id: string }[]>`select route_id from app.matching_attestation_routes(${d.id}) limit 1`
      if (!m) continue
      // the documentation staff member actually assigned to the student (falls back to the given worker)
      const [assigned] = await sql<{ user_id: string }[]>`select user_id from student_assignments
        where student_id = ${id} and assignment_type = 'documentation' and is_active limit 1`
      const w = assigned?.user_id ?? worker(i)
      await as(sql, w, (tx) => tx`select app.start_attestation(${d.id}, ${m.route_id})`)
      n++
      const [first] = await sql<{ id: string }[]>`select s.id from document_attestation_steps s join document_attestations a on a.id = s.attestation_id
                                                   where a.student_document_id = ${d.id} and a.status = 'in_progress' order by s.sort_order limit 1`
      if (i % 2 === 0) await as(sql, w, (tx) => tx`select app.attestation_step_action(${first.id}, 'start', ${'DEMO-REF-' + (1000 + i)}, null, 'Submitted (demo)', null)`)
      if (i % 3 === 0) await as(sql, w, (tx) => tx`select app.attestation_step_action(${first.id}, 'complete', ${'DEMO-REF-' + (1000 + i)}, null, 'Completed (demo)', null)`)
    }
  }
  return n
}
