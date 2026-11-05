import { describe, expect, it } from 'vitest'
import { scanSql, scanTypeScript, sqlFileInScope, withoutBaseline } from '../../scripts/lib/sql-guard'

const ts = (code: string, file = 'backend/src/services/x.ts') => scanTypeScript(file, code).map((f) => f.rule)
const sql = (code: string, file = 'backend/db/migrations/0040_x.sql') => scanSql(file, code).map((f) => f.rule)

describe('application code: detected', () => {
  it.each([
    ['request value in .unsafe', 'function f(tx, id) { return tx.unsafe(`select * from t where id = ${id}`) }', 'SG01'],
    ['joined text in .unsafe', 'function f(tx, id) { return tx.unsafe("select * from t where id = " + id) }', 'SG01'],
    ['variable text in .unsafe', 'function f(tx, q) { return tx.unsafe(q) }', 'SG01'],
    ['let variable in .unsafe', 'let q = "select 1"; q = input(); tx.unsafe(q)', 'SG01'],
    ['non-constant lookup in .unsafe', 'const S = { a: input() }; tx.unsafe(S[k])', 'SG01'],
    ['bracket form', 'function f(tx, q) { return tx["unsafe"](q) }', 'SG01'],
    ['.unsafe taken as a value', 'const run = tx.unsafe; run(q)', 'SG02'],
    ['SQL string built from a value', 'function f(id) { const q = `select * from t where id = ${id}`; return q }', 'SG03'],
    ['SQL string joined from a value', 'function f(id) { return "delete from t where id = " + id }', 'SG03'],
    ['setting identity in a service', 'tx`select set_config(\'app.user_id\', ${x}, true)`', 'SG04'],
    ['setting a guard flag in a service', 'tx`select set_config(\'app.stage_change\', \'on\', true)`', 'SG04'],
    ['changing role', 'tx`set local role postgres`', 'SG05'],
    ['reading private tables', 'tx`select * from auth_private.credentials`', 'SG06'],
    ['administrator connection', 'const u = process.env.DATABASE_ADMIN_URL', 'SG07'],
    ['secret sent to the browser', 'const u = process.env.NEXT_PUBLIC_DATABASE_URL', 'SG08'],
  ])('%s', (_n, code, rule) => { expect(ts(code)).toContain(rule) })
})

describe('application code: not flagged', () => {
  it.each([
    ['bound values', 'function f(tx, id) { return tx`select * from t where id = ${id}` }'],
    ['fixed text with a parameter', 'function f(tx, id) { return tx.unsafe("select * from t where id = $1", [id]) }'],
    ['constant in a template', 'const BASE = "select * from t"; function f(tx, id) { return tx.unsafe(`${BASE} where id = $1`, [id]) }'],
    ['choice between fixed texts', 'function f(tx, a) { return tx.unsafe(`select 1 where ${a ? "true" : "false"}`) }'],
    ['allow-list lookup', 'const SORTS = { a: "x asc", b: "y desc" }; function f(tx, k) { return tx.unsafe(SORTS[k] ?? SORTS.a) }'],
    ['ordinary text', 'function f(n) { return `Hello ${n}` }'],
    ['the word select in a label', 'function f(n) { return `Please select ${n}` }'],
  ])('%s', (_n, code) => { expect(ts(code)).toEqual([]) })

  it('the database module may set the settings', () => {
    expect(ts('tx`select set_config(\'app.user_id\', ${x}, true)`', 'backend/src/lib/db.ts')).toEqual([])
  })
})

describe('migrations: detected', () => {
  it.each([
    ['no search_path', 'create function app.f() returns int language sql security definer as $$ select 1 $$; revoke execute on function app.f() from public;', 'SQL01'],
    ['still public', 'create function app.f() returns int language sql security definer set search_path = public as $$ select 1 $$;', 'SQL02'],
    ['grant to public', 'grant execute on function app.f() to public;', 'SQL03'],
    ['joined dynamic SQL', "create function f() returns void language plpgsql as $$ begin execute 'select ' || x; end $$;", 'SQL04'],
    ['format with %s', "create function f() returns void language plpgsql as $$ begin execute format('select %s', x); end $$;", 'SQL04'],
    ['RLS off', 'alter table students disable row level security;', 'SQL05'],
    ['trigger off', 'alter table students disable trigger all;', 'SQL05'],
    ['table without RLS', 'create table things (id int);', 'SQL06'],
    ['policy for every row', 'create policy p on t using (true);', 'SQL07'],
    ['identity from the settable value', "select current_setting('app.user_id', true);", 'SQL08'],
  ])('%s', (_n, code, rule) => { expect(sql(code)).toContain(rule) })
})

describe('migrations: not flagged', () => {
  it.each([
    ['a correct privileged function', 'create function app.f() returns int language sql security definer set search_path = public, pg_temp as $$ select 1 $$;\nrevoke execute on function app.f() from public;'],
    ['safe dynamic SQL', "create function f() returns void language plpgsql as $$ begin execute format('select %I', x); end $$;"],
    ['a table with RLS', 'create table things (id int);\nalter table things enable row level security;'],
    ['commented-out text', '-- grant execute on function app.f() to public;\n/* alter table t disable row level security; */\nselect 1;'],
  ])('%s', (_n, code) => { expect(sql(code)).toEqual([]) })
})

describe('scope and approvals', () => {
  it('leaves applied migrations alone and checks new ones', () => {
    expect(sqlFileInScope('backend/db/migrations/0038_passport_warning_only.sql')).toBe(false)
    expect(sqlFileInScope('backend/db/migrations/0039_x.sql')).toBe(true)
    expect(sqlFileInScope('backend/db/rollbacks/0040_x.down.sql')).toBe(true)
  })
  it('a baseline entry approves only its exact code, and an unused entry is reported', () => {
    const f = { rule: 'SG01', file: 'a.ts', line: 1, code: 'tx.unsafe(a)', message: '' }
    const other = { ...f, code: 'tx.unsafe(b)' }
    const entry = { rule: 'SG01', file: 'a.ts', code: 'tx.unsafe(a)', reason: 'reviewed' }
    expect(withoutBaseline([f, other], [entry]).unapproved).toEqual([other])
    expect(withoutBaseline([], [entry]).stale).toEqual([entry])
  })
})

// These pass because the guard CANNOT see them. They record its limits, which are listed in the guard report.
describe('known limits: not detected', () => {
  it.each([
    ['a column name from a request, through the identifier helper', 'function f(tx, col) { return tx`select ${tx(col)} from t` }'],
    ['a missing permission check in a correct query', 'function f(tx) { return tx`select * from students` }'],
    ['SQL text received from another file', 'import { q } from "./q"; function g(tx) { return tx`${q}` }'],
  ])('%s', (_n, code) => { expect(ts(code)).toEqual([]) })
})
