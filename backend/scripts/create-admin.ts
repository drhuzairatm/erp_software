/**
 * Initial administrator provisioning (run once per environment, by a person
 * with database admin access — never through the web app).
 *
 *   npm run admin:create -- --email it@yourcompany.com --name "Full Name" \
 *        --role system_admin --orgs EDX,GRD
 *
 * Creates the account (or adds memberships to an existing one) and prints a
 * ONE-TIME password setup link valid for 24 hours. No password is ever
 * printed, stored in files, or passed on the command line.
 *
 * --role accepts any role key, e.g. system_admin or md.
 *
 * Protected MD: the first MD is created with --role md. Once an active MD exists, the database refuses
 * another one unless --allow-additional-md is given deliberately (both are recorded in the audit log).
 * The MD role can never be granted from inside the web app.
 */
import { parseArgs } from 'node:util'
import postgres from 'postgres'
import { hashToken, newTokenValue } from '../src/server/auth/tokens'
import { loadEnv, requireEnv } from './lib/env'

loadEnv()
const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' }, 'allow-additional-md': { type: 'boolean', default: false }, role: { type: 'string', default: 'system_admin' }, orgs: { type: 'string', default: 'EDX,GRD' } },
})
if (!values.email || !values.name) {
  console.error('Usage: npm run admin:create -- --email someone@company.com --name "Full Name" [--role system_admin] [--orgs EDX,GRD]')
  process.exit(1)
}
const email = values.email.trim().toLowerCase()
const orgCodes = values.orgs!.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const sql = postgres(requireEnv('DATABASE_ADMIN_URL'), { max: 1, onnotice: () => {} })

try {
  const token = newTokenValue()
  await sql.begin(async (tx) => {
    if (values['allow-additional-md']) {
      await tx`select set_config('app.allow_additional_md', 'on', true)`
      console.log('WARNING: --allow-additional-md given: an additional MD may be created (audited).')
    }
    let [user] = await tx<{ id: string }[]>`select id from user_profiles where lower(email) = ${email}`
    if (!user) {
      ;[user] = await tx<{ id: string }[]>`insert into user_profiles (email, full_name, account_status) values (${email}, ${values.name!}, 'invited') returning id`
      console.log(`Created account for ${email}`)
    }
    for (const code of orgCodes) {
      const [role] = await tx<{ id: string; org_id: string }[]>`
        select r.id, r.org_id from roles r join organizations o on o.id = r.org_id where o.code = ${code} and r.key = ${values.role!}`
      if (!role) throw new Error(`Role "${values.role}" not found in company ${code}. Run npm run db:provision first.`)
      await tx`insert into organization_memberships (user_id, org_id, role_id) values (${user.id}, ${role.org_id}, ${role.id})
               on conflict (user_id, org_id) do update set role_id = excluded.role_id, is_active = true`
      console.log(`  ${code}: ${values.role}`)
    }
    await tx`update auth_private.password_resets set used_at = now() where user_id = ${user.id} and used_at is null`
    await tx`insert into auth_private.password_resets (user_id, token_hash, requested_via, expires_at)
             values (${user.id}, ${hashToken(token)}, 'administrator', now() + interval '24 hours')`
    await tx`select app.audit('admin_provisioned', 'user_profiles', ${user.id}::text, null, null, null,
                              ${tx.json({ role: values.role!, orgs: orgCodes })}, 'success', '{"via":"cli"}'::jsonb, null)`
  })
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  console.log(`\nOne-time setup link (valid 24 hours, share securely):\n${base}/reset-password/${token}\n`)
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  console.error(msg.includes('An MD account already exists')
    ? 'Refused: an MD account already exists. Use --allow-additional-md only if the current MD has approved a second MD.'
    : msg)
  process.exitCode = 1
} finally {
  await sql.end()
}
