import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import { commitImport, previewImport } from '@/services/student-import'
import { adminSql, ctxFor, orgId } from '../support/helpers'

let EDX: string, GRD: string
beforeAll(async () => { EDX = await orgId('EDX'); GRD = await orgId('GRD') })
afterAll(async () => { await adminSql().end(); await db().end() })

const uniq = () => String(Math.floor(Math.random() * 90000) + 10000)

async function existingEdxOnlyPhone() {
  const [r] = await adminSql()`select phone from students s join organizations o on o.id = s.originating_org_id
                               where o.code = 'EDX' and s.processing_org_id is null and phone is not null limit 1`
  return r.phone as string
}

describe('CSV import', () => {
  it('previews rows with ready / duplicate / error status without writing anything', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const p = uniq()
    const before = await adminSql()`select count(*)::int as n from students`
    const csv = [
      'Student Name,Mobile,Email,Country,Course,Lead Source,Registration Date,Counsellor Email,Notes',
      `Import Ready One,+91 90001 ${p},,Russia,MBBS,Website,01/10/2026,edx.counsellor@demo.test,Prefers evening calls`,
      `Import Dup In File,+91 90001 ${p},,,,,,,`,
      'Import Bad Country,+91 90002 12345,,Atlantis,MBBS,,,,',
      'Import Bad Date,+91 90003 12345,,,,,31/02/2026,,',
      'No Contact,,,,,,,,',
      'Import Excel Phone,9.19E+11,,,,,,,',
    ].join('\n')
    const a = await previewImport(mgr, EDX, csv)
    expect(a.rows.map((r) => r.status)).toEqual(['ready', 'duplicate', 'error', 'error', 'error', 'error'])
    expect(a.rows[1].messages.join()).toMatch(/line 2 of this file/)
    expect(a.rows[2].messages.join()).toMatch(/Atlantis/)
    expect(a.rows[5].messages.join()).toMatch(/scientific notation/)
    const after = await adminSql()`select count(*)::int as n from students`
    expect(after[0].n).toBe(before[0].n)
  })

  it('imports only eligible rows, assigns counsellor, adds notes, and audits the import', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const a = uniq(), b = uniq()
    const csv = `Name,Phone,Country,Course,Counsellor,Notes\nImport Alpha,+91 90004 ${a},Russia,MBBS,edx.counsellor@demo.test,Note A\nImport Beta,+91 90005 ${b},,,,\nBroken,,,,,\n`
    const r = await commitImport(mgr, EDX, csv, { includeDuplicates: false, fileName: 'leads.csv' })
    expect(r.imported).toHaveLength(2)
    expect(r.skipped).toEqual([{ line: 4, reason: 'error' }])
    for (const i of r.imported) expect(i.studentCode).toMatch(/^EDX-\d{2}-\d{6}$/)
    const [alpha] = await adminSql()`select s.id, s.workflow_id, w.name as wf from students s join workflow_definitions w on w.id = s.workflow_id where s.id = ${r.imported[0].id}`
    expect(alpha.wf).toBe('MBBS – Russia')
    const [asg] = await adminSql()`select u.email from student_assignments a join user_profiles u on u.id = a.user_id where a.student_id = ${alpha.id} and a.assignment_type = 'counsellor'`
    expect(asg.email).toBe('edx.counsellor@demo.test')
    const [note] = await adminSql()`select body from student_notes where student_id = ${alpha.id}`
    expect(note.body).toBe('Note A')
    const docs = await adminSql()`select count(*)::int as n from student_documents where student_id = ${alpha.id}`
    expect(docs[0].n).toBeGreaterThan(0)
    const [log] = await adminSql()`select metadata from audit_logs where action = 'import' and actor_user_id = ${mgr.userId} order by id desc limit 1`
    expect(log.metadata).toMatchObject({ file: 'leads.csv', imported: 2, skipped: 1 })
  })

  it('skips possible duplicates unless explicitly included', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const phone = `+91 90006 ${uniq()}`
    await commitImport(mgr, EDX, `Name,Phone\nFirst Person,${phone}\n`, { includeDuplicates: false, fileName: 'a.csv' })
    await expect(commitImport(mgr, EDX, `Name,Phone\nSame Phone,${phone}\n`, { includeDuplicates: false, fileName: 'b.csv' })).rejects.toThrow(/No rows were eligible/)
    const r = await commitImport(mgr, EDX, `Name,Phone\nSame Phone,${phone}\n`, { includeDuplicates: true, fileName: 'c.csv' })
    expect(r.imported).toHaveLength(1)
  })

  it('refuses users without the import permission or for another company', async () => {
    const counsellor = await ctxFor('edx.counsellor@demo.test') // can register, cannot bulk import
    await expect(previewImport(counsellor, EDX, 'Name,Phone\nX Y,+91 90009 11111\n')).rejects.toBeInstanceOf(ServiceError)
    const edxMgr = await ctxFor('edx.manager@demo.test')
    await expect(commitImport(edxMgr, GRD, 'Name,Phone\nX Y,+91 90009 11112\n', { includeDuplicates: false, fileName: 'x.csv' }))
      .rejects.toThrow(/permission/)
  })

  it('rejects files that are too large, not UTF-8, or missing required columns', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    await expect(previewImport(mgr, EDX, 'Country,Course\nRussia,MBBS\n')).rejects.toThrow(/Full name/)
    await expect(previewImport(mgr, EDX, 'Name,Phone\nBad �,123\n')).rejects.toThrow(/UTF-8/)
    const rows = Array.from({ length: 1001 }, (_, i) => `P${i},+91 90010 ${String(i).padStart(5, '0')}`).join('\n')
    await expect(previewImport(mgr, EDX, `Name,Phone\n${rows}\n`)).rejects.toThrow(/limit is 1000/)
  })
})

describe('CSV import across brands', () => {
  it('a match in a brand the importer cannot see reveals only the company name', async () => {
    const grdMgr = await ctxFor('grd.manager@demo.test')
    const a = await previewImport(grdMgr, await orgId('GRD'), `Name,Phone\nCross Brand Person,${await existingEdxOnlyPhone()}\n`)
    expect(a.rows[0].status).toBe('duplicate')
    expect(a.rows[0].messages).toContain('Matches a record in Dr.Expert Edulinks on phone (not visible to you)')
    expect(a.rows[0].messages.join()).not.toMatch(/EDX-/)
  })
})

describe('Leadist CRM export layout', () => {
  it('imports Name/Phone/Email/Assigned To/Purpose, assigns by staff name, ignores Address', async () => {
    const mgr = await ctxFor('edx.manager@demo.test')
    const a = uniq(), b = uniq(), c = uniq()
    const csv = [
      'Name,Phone,Email,Assigned To,Purpose,Address',
      `Leadist Person One,+91 90020 ${a},one.${a}@example.test,Anjali Varma,MBBS in Russia,"12 Fictional Road, Kochi"`,
      `Leadist Person Two,+91 90021 ${b},,anjali varma (demo),Nursing Germany,`,
      `Leadist Person Three,+91 90022 ${c},,Somebody Unknown,PG enquiry,`,
    ].join('\n')
    const preview = await previewImport(mgr, EDX, csv)
    expect(preview.ignored).toEqual(['Address'])
    expect(preview.rows.map((r) => r.status)).toEqual(['ready', 'ready', 'error'])
    expect(preview.rows[2].messages.join()).toMatch(/"Somebody Unknown" is not an active staff member/)

    const r = await commitImport(mgr, EDX, csv, { includeDuplicates: false, fileName: 'leadist.csv' })
    expect(r.imported).toHaveLength(2)
    const id = r.imported[0].id
    const [asg] = await adminSql()`select u.email from student_assignments x join user_profiles u on u.id = x.user_id
                                   where x.student_id = ${id} and x.assignment_type = 'counsellor' and x.is_active`
    expect(asg.email).toBe('edx.counsellor@demo.test')
    const [note] = await adminSql()`select body from student_notes where student_id = ${id}`
    expect(note.body).toBe('Purpose: MBBS in Russia')
    // the address is not stored anywhere on the student
    const [row] = await adminSql()`select to_jsonb(s)::text as j from students s where id = ${id}`
    expect(row.j).not.toContain('Fictional Road')
  })
})

describe('import template', () => {
  it('its two fictional example rows pass validation and fill country, course and workflow', async () => {
    const { importTemplateCsv } = await import('@/services/student-import')
    const mgr = await ctxFor('edx.manager@demo.test')
    const a = await previewImport(mgr, EDX, importTemplateCsv())
    expect(a.ignored).toEqual([])
    expect(a.rows.map((r) => [r.status, r.messages])).toEqual([['ready', []], ['ready', []]])
    expect(a.rows[1].summary).toBe('Germany · Nursing · Nursing enquiry')
  })
})
