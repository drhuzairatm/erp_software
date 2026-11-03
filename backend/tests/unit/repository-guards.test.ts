/**
 * Repository Pattern guards (plan §7), for what has been migrated so far (Stage 2: files and photos, read-only).
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(import.meta.dirname, '../../src')
const read = (p: string) => readFileSync(path.join(SRC, p), 'utf8')
/** Source without comments (so documentation may mention what the code must not do). */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const walk = (dir: string): string[] => readdirSync(path.join(SRC, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []))

/** The body of an exported function (up to the next top-level declaration). */
function fnBody(file: string, name: string) {
  const s = read(file)
  const i = s.indexOf(`export async function ${name}(`)
  expect(i, `${file}: ${name}`).toBeGreaterThanOrEqual(0)
  const rest = s.slice(i + 1)
  const end = rest.search(/\n(export |const |function |async function )/)
  return end < 0 ? rest : rest.slice(0, end)
}

describe('repository guards', () => {
  it('repositories never open transactions or set request settings', () => {
    for (const f of walk('repositories')) {
      const s = code(f)
      for (const banned of ['begin(', 'withUser(', 'anonymous(', 'run(', 'set_config', 'from \'../services']) expect(s, `${f} uses ${banned}`).not.toContain(banned)
    }
  })

  it('the migrated read functions contain no SQL (it lives in the repositories)', () => {
    const migrated: [string, string[]][] = [
      ['services/documents.ts', ['fileContent', 'openFile']],
      ['services/photos.ts', ['studentPhotoBytes', 'studentPhotoDownloadUrl', 'currentPhoto']],
      ['services/staff-photos.ts', ['staffPhotoBytes', 'staffPhotoVersions']],
      ['services/files.ts', ['localSignedFile']],
    ]
    for (const [file, fns] of migrated) for (const fn of fns) expect(fnBody(file, fn), `${file}: ${fn}`).not.toMatch(/tx(<[^>]*>)?`|\bselect\b/i)
  })

  it('controllers, routes and middleware do HTTP only: no database or storage access, no SQL', () => {
    // (routes/health.routes.ts, Stage 1, checks the database itself on purpose: it has no service)
    for (const f of [...walk('controllers'), ...walk('middleware'), ...walk('routes').filter((x) => !x.endsWith('health.routes.ts'))]) {
      const s = code(f)
      expect(s, f).not.toMatch(/from '(@|\.\.)\/(lib\/(db|storage)|repositories)/)
      expect(s, f).not.toMatch(/tx(<[^>]*>)?`/)
    }
  })

  it('no next/* imports anywhere in backend/src', () => {
    for (const f of walk('.')) expect(read(f), f).not.toMatch(/from 'next(\/|')/)
  })
})
