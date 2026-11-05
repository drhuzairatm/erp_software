/**
 * SQL security guard: reads source files and reports unsafe SQL patterns. It never changes a file, a function or a
 * permission, and it never connects to a database. See backend/scripts/sql-guard.ts for how it is run.
 */
import ts from 'typescript'

export type Finding = { rule: string; file: string; line: number; code: string; message: string }

/** Migrations up to this number were reviewed and are already applied, so they cannot be changed. */
export const LAST_REVIEWED_MIGRATION = 38

const IDENTITY_SETTINGS_ALLOWED_IN = new Set(['backend/src/lib/db.ts'])
const SQL_TEXT = /\b(select\s[\s\S]*\sfrom\s|insert\s+into\s|update\s+[\w."]+\s+set\s|delete\s+from\s|alter\s+(table|role|default)\s|drop\s+(table|function|policy)\s|grant\s+\w+|set_config\s*\()/i

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 160)

/** A value is constant only if every part of it is fixed in the source: nothing can come from a request. */
function isConstant(node: ts.Expression, consts: Map<string, ts.Expression[]>, seen = new Set<string>()): boolean {
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return true
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
    return isConstant(node.expression, consts, seen)
  }
  if (ts.isTemplateExpression(node)) return node.templateSpans.every((s) => isConstant(s.expression, consts, seen))
  if (ts.isConditionalExpression(node)) return isConstant(node.whenTrue, consts, seen) && isConstant(node.whenFalse, consts, seen)
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind
    if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
      return isConstant(node.left, consts, seen) && isConstant(node.right, consts, seen)
    }
    return false
  }
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return false
    const defs = consts.get(node.text)
    if (!defs?.length) return false
    const next = new Set(seen).add(node.text)
    return defs.every((d) => isConstant(d, consts, next))
  }
  // An allow-list lookup: SORTS[key] or SORTS.newest, on a const object whose values are all constant.
  if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) {
    const target = node.expression
    if (!ts.isIdentifier(target)) return false
    const defs = consts.get(target.text)
    if (defs?.length !== 1) return false
    let def = defs[0]!
    while (ts.isAsExpression(def) || ts.isSatisfiesExpression(def) || ts.isParenthesizedExpression(def)) def = def.expression
    if (!ts.isObjectLiteralExpression(def)) return false
    return def.properties.every((p) => ts.isPropertyAssignment(p) && isConstant(p.initializer, consts, seen))
  }
  return false
}

/** Top-level and local `const x = ...` declarations. Parameters and `let` are never constant. */
function collectConsts(sf: ts.SourceFile) {
  const consts = new Map<string, ts.Expression[]>()
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclarationList(n) && n.flags & ts.NodeFlags.Const) {
      for (const d of n.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) consts.set(d.name.text, [...(consts.get(d.name.text) ?? []), d.initializer])
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  // A name that is also a parameter or a `let` could hold anything.
  const shadow = (n: ts.Node) => {
    if ((ts.isParameter(n) || (ts.isVariableDeclaration(n) && !(n.parent.flags & ts.NodeFlags.Const))) && ts.isIdentifier(n.name)) consts.delete(n.name.text)
    ts.forEachChild(n, shadow)
  }
  shadow(sf)
  return consts
}

export function scanTypeScript(file: string, text: string): Finding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const consts = collectConsts(sf)
  const out: Finding[] = []
  const add = (rule: string, node: ts.Node, message: string) => out.push({
    rule, file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, code: normalise(node.getText()), message,
  })
  const unsafeName = (n: ts.Node) => (ts.isPropertyAccessExpression(n) && n.name.text === 'unsafe')
    || (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === 'unsafe')

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && unsafeName(n.expression)) {
      const arg = n.arguments[0]
      if (!arg || !isConstant(arg, consts)) add('SG01', n, '.unsafe() with text that is not fixed in the source. Use a tagged template with bound values.')
    } else if (unsafeName(n) && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) {
      add('SG02', n, '.unsafe taken as a value, so its later use cannot be checked.')
    }
    // SQL assembled as an ordinary string, outside a tagged template that would bind the values
    if ((ts.isTemplateExpression(n) && !ts.isTaggedTemplateExpression(n.parent)) || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const outer = ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken
      if (!outer && SQL_TEXT.test(n.getText()) && !isConstant(n as ts.Expression, consts)) add('SG03', n, 'SQL built as a string from values that are not fixed in the source.')
    }
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      const t = n.text
      if (/set_config\s*\(\s*'(app\.[a-z_]+)/i.test(t) && !IDENTITY_SETTINGS_ALLOWED_IN.has(file)) {
        add('SG04', n, 'Sets an app.* database setting (identity, IP or guard flag) outside backend/src/lib/db.ts.')
      }
      if (/\bset\s+(local\s+|session\s+)?(role|session\s+authorization)\b/i.test(t)) add('SG05', n, 'Changes the database role from application code.')
      if (/\bauth_private\./i.test(t) && /\b(select|insert|update|delete)\b/i.test(t)) add('SG06', n, 'Reads or writes auth_private directly. Use a database function.')
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'DATABASE_ADMIN_URL') add('SG07', n, 'The administrator database connection is used in running application code.')
    if (ts.isPropertyAccessExpression(n) && /^NEXT_PUBLIC_.*(DATABASE|SECRET|KEY|PASSWORD|TOKEN)/.test(n.name.text)) add('SG08', n, 'A secret-looking value is exposed to the browser through NEXT_PUBLIC_.')
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))

export function scanSql(file: string, raw: string): Finding[] {
  const sql = stripSqlComments(raw)
  const out: Finding[] = []
  const lineOf = (i: number) => sql.slice(0, i).split('\n').length
  const add = (rule: string, i: number, code: string, message: string) => out.push({ rule, file, line: lineOf(i), code: normalise(code), message })
  const each = (re: RegExp, fn: (m: RegExpMatchArray, i: number) => void) => { for (const m of sql.matchAll(re)) fn(m, m.index ?? 0) }

  // Function header: from "create function" up to the opening of its body
  each(/create\s+(or\s+replace\s+)?function\s+([\w."]+)\s*\([\s\S]*?(\$[a-z_]*\$)/gi, (m, i) => {
    const header = m[0]; const name = m[2]!
    if (/security\s+definer/i.test(header) || /security\s+definer/i.test(sql.slice(i + header.length).split(m[3]!)[1]?.slice(0, 120) ?? '')) {
      const after = sql.slice(i + header.length).split(m[3]!)[1]?.slice(0, 160) ?? ''
      if (!/set\s+search_path/i.test(header + after)) add('SQL01', i, name, 'SECURITY DEFINER function without a fixed search_path.')
      const short = name.replace(/"/g, '')
      if (!new RegExp(`revoke\\s+[^;]*${short.replace(/[.]/g, '\\.')}[^;]*from\\s+public`, 'i').test(sql)) {
        add('SQL02', i, name, 'New SECURITY DEFINER function without "revoke execute ... from public" in the same file.')
      }
    }
  })
  // The proposed Stage A and B rollback exists only to restore today's PUBLIC access, if that change is ever undone.
  if (!file.endsWith('/0039_function_permissions.down.sql')) each(/grant\s+[^;]*\bto\s+public\b[^;]*;/gi, (m, i) => add('SQL03', i, m[0], 'Grants a permission to PUBLIC.'))
  each(/\bexecute\s+(?!function\b|procedure\b|on\b)[^;]*;/gi, (m, i) => {
    if (m[0].includes('||') || /format\s*\(\s*'[^']*%s/i.test(m[0])) add('SQL04', i, m[0], 'Dynamic SQL built by joining text or with %s. Use format() with %I and %L, and USING.')
  })
  each(/\bdisable\s+row\s+level\s+security|\bno\s+force\s+row\s+level\s+security|\bdisable\s+trigger\b/gi, (m, i) => add('SQL05', i, m[0], 'Turns off row-level security or a trigger.'))
  each(/create\s+table\s+(if\s+not\s+exists\s+)?(?:public\.)?("?[a-z_][\w]*"?)\s*\(/gi, (m, i) => {
    const t = m[2]!.replace(/"/g, '')
    if (t !== 'schema_migrations' && !new RegExp(`alter\\s+table\\s+(public\\.)?"?${t}"?\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql)) add('SQL06', i, m[0], `New table ${t} without row-level security in the same file.`)
  })
  each(/\b(using|with\s+check)\s*\(\s*true\s*\)/gi, (m, i) => add('SQL07', i, m[0], 'A policy that allows every row.'))
  each(/(?:set_config|current_setting)\s*\(\s*'app\.user_id'/gi, (m, i) => add('SQL08', i, m[0], 'Uses the settable app.user_id value. It proves nothing about who is signed in.'))
  return out
}

/** Only migrations and rollbacks after the reviewed one are checked; earlier ones are applied and cannot change. */
export function sqlFileInScope(file: string) {
  const m = /backend\/db\/(migrations|rollbacks)\/(\d{4})_/.exec(file)
  return !!m && Number(m[2]) > LAST_REVIEWED_MIGRATION
}

export type BaselineEntry = { rule: string; file: string; code: string; reason: string }

export function withoutBaseline(found: Finding[], baseline: BaselineEntry[]) {
  const key = (x: { rule: string; file: string; code: string }) => `${x.rule}|${x.file}|${x.code}`
  const allowed = new Set(baseline.map(key))
  const seen = new Set(found.map(key))
  return { unapproved: found.filter((f) => !allowed.has(key(f))), stale: baseline.filter((b) => !seen.has(key(b))) }
}
