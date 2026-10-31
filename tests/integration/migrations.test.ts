/** Phase 0: every migration from 0017 has a rollback; rolling back and re-applying works. */
import { existsSync, readdirSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { ROLLBACK_REQUIRED_FROM, rollbackFileFor, rollbackTo, runMigrations } from '../../scripts/lib/migrations'
import { adminSql } from '../support/helpers'

afterAll(async () => { await adminSql().end() })

describe('migration safety', () => {
  it('every migration from 0017 on has a rollback script', () => {
    const files = readdirSync('db/migrations').filter((f) => Number(f.slice(0, 4)) >= ROLLBACK_REQUIRED_FROM)
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) expect(existsSync(rollbackFileFor(f)), f).toBe(true)
  })

  it('rolling back the newest migrations and re-applying leaves the database consistent', async () => {
    const url = process.env.DATABASE_ADMIN_URL!
    const before = await adminSql()`select version from schema_migrations order by version`
    const quiet = () => {}
    await rollbackTo(url, String(ROLLBACK_REQUIRED_FROM).padStart(4, '0'), quiet)
    const mid = await adminSql()`select max(version) as v from schema_migrations`
    expect(Number(String(mid[0].v).slice(0, 4))).toBeLessThan(ROLLBACK_REQUIRED_FROM)
    await runMigrations(url, { log: quiet })
    const after = await adminSql()`select version from schema_migrations order by version`
    expect(after.map((r) => r.version)).toEqual(before.map((r) => r.version))
  })
})
