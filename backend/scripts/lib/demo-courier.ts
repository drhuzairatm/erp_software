import type postgres from 'postgres'

/** One clearly fictional delivery address per company (demo databases only). Real addresses are entered by each company. */
export async function demoCourierAddresses(sql: postgres.Sql) {
  let n = 0
  for (const o of await sql<{ id: string; name: string }[]>`select id, name from organizations`) {
    const r = await sql`insert into courier_addresses (org_id, label, recipient, address, phone, instructions)
      select ${o.id}, '[DEMO] Office address (fictional)', ${'Documents desk – ' + o.name + ' (DEMO)'},
             ${'[DEMO – NOT A REAL ADDRESS]\nBuilding 0, Example Road\nDemo City 000000'}, '+91 00000 00000',
             'Demo only. Place the originals in a sealed envelope; do not fold certificates.'
       where not exists (select 1 from courier_addresses where org_id = ${o.id} and label like '[DEMO]%')`
    n += r.count
  }
  return n
}
