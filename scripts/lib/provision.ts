import postgres from 'postgres'
import { COUNTRIES, COURSES, DEFAULT_ROLES, DEPARTMENTS, NOTIFICATION_TEMPLATES, DOCUMENT_TYPES, FEE_CATEGORIES, LEAD_SOURCES, ORGANIZATIONS, WORKFLOWS } from './defaults'

/**
 * Idempotently installs organizations, default roles, and reference data.
 * Existing rows are left alone (so later changes made in the app are kept);
 * missing rows are added.
 */
export async function provision(adminUrl: string, log: (m: string) => void = console.log) {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} })
  try {
    await sql.begin(async (tx) => {
      for (const o of ORGANIZATIONS) {
        await tx`insert into organizations (code, name, student_code_prefix, settings)
                 values (${o.code}, ${o.name}, ${o.prefix}, ${tx.json(o.settings)})
                 on conflict (code) do nothing`
      }
      const orgs = await tx<{ id: string; code: string }[]>`select id, code from organizations`
      for (const org of orgs) {
        for (const r of DEFAULT_ROLES) {
          const [role] = await tx<{ id: string }[]>`
            insert into roles (org_id, key, name, description, is_system, is_privileged, is_protected, requires_mfa)
            values (${org.id}, ${r.key}, ${r.name}, ${r.description}, true, ${r.privileged ?? false}, ${r.protected ?? false}, ${r.mfa ?? false})
            on conflict (org_id, key) do update set is_system = true
            returning id`
          const existing = await tx`select 1 from role_permissions where role_id = ${role.id} limit 1`
          if (!existing.length) {
            for (const p of r.permissions) {
              await tx`insert into role_permissions (role_id, permission_key) values (${role.id}, ${p}) on conflict do nothing`
            }
          }
        }
        for (const [key, name, kind] of FEE_CATEGORIES) {
          await tx`insert into fee_categories (org_id, key, name, kind) values (${org.id}, ${key}, ${name}, ${kind})
                   on conflict (org_id, key) do nothing`
        }
        for (const t of NOTIFICATION_TEMPLATES) {
          for (const channel of ['email', 'whatsapp'] as const) {
            const [tpl] = await tx<{ id: string }[]>`
              insert into notification_templates (org_id, name, channel, subject, body, provider_params)
              values (${org.id}, ${t.name}, ${channel}, ${channel === 'email' ? t.email.subject : null},
                      ${channel === 'email' ? t.email.body : t.whatsapp.body}, ${channel === 'whatsapp' ? tx.array(t.whatsapp.params) : tx.array([])}::text[])
              on conflict (org_id, name, channel, language) do update set name = excluded.name returning id`
            // Rules are created DISABLED: the MD/administrator switches them on after checking the wording.
            await tx`insert into notification_rules (org_id, event_key, channel, audience, template_id, is_enabled)
                     values (${org.id}, ${t.event}, ${channel}, 'student', ${tpl.id}, false) on conflict do nothing`
          }
        }
        // Student portal sign-in code (sent on request; does not use rules)
        for (const channel of ['email', 'whatsapp'] as const) {
          await tx`insert into notification_templates (org_id, name, channel, subject, body, provider_params)
                   values (${org.id}, 'Portal sign-in code', ${channel},
                           ${channel === 'email' ? 'Your sign-in code: {{code}}' : null},
                           ${channel === 'email'
                             ? 'Your {{company}} student portal sign-in code is {{code}}. It expires in 10 minutes. If you did not ask for it, ignore this message.'
                             : 'Your {{company}} student portal code is {{code}}. It expires in 10 minutes.'},
                           ${channel === 'whatsapp' ? tx.array(['code']) : tx.array([])}::text[])
                   on conflict (org_id, name, channel, language) do nothing`
        }
        // Email verification link (sent on staff request; does not use rules)
        await tx`insert into notification_templates (org_id, name, channel, subject, body)
                 values (${org.id}, 'Email verification', 'email', 'Please confirm your email address',
                         ${'Dear {{student_name}},\n\nPlease confirm this email address for your {{company}} student record by opening the link below and pressing "Confirm":\n\n{{link}}\n\nThe link is valid for 48 hours. If you did not expect this message, ignore it.\n\nRegards,\n{{company}}'})
                 on conflict (org_id, name, channel, language) do nothing`
        for (const name of DEPARTMENTS) {
          await tx`insert into departments (org_id, name) values (${org.id}, ${name}) on conflict (org_id, name) do nothing`
        }
        for (const name of LEAD_SOURCES) {
          await tx`insert into lead_sources (org_id, name) values (${org.id}, ${name}) on conflict (org_id, name) do nothing`
        }
      }
      for (const [code, name, destination, origin] of COUNTRIES) {
        await tx`insert into countries (code, name, is_destination, is_education_origin) values (${code}, ${name}, ${destination}, ${origin})
                 on conflict (code) do nothing`
      }
      for (const [code, name, sort] of COURSES) {
        await tx`insert into courses (code, name, sort_order) values (${code}, ${name}, ${sort}) on conflict (code) do nothing`
      }
      for (const [key, name, category, hasExpiry, sort] of DOCUMENT_TYPES) {
        await tx`insert into document_types (key, name, category, has_expiry, sort_order)
                 values (${key}, ${name}, ${category}, ${hasExpiry}, ${sort}) on conflict (key) do nothing`
      }
      for (const w of WORKFLOWS) {
        const [country] = w.country ? await tx<{ id: string }[]>`select id from countries where code = ${w.country}` : [undefined]
        const [course] = w.course ? await tx<{ id: string }[]>`select id from courses where code = ${w.course}` : [undefined]
        const inserted = await tx<{ id: string }[]>`
          insert into workflow_definitions (name, description, country_id, course_id, is_default)
          values (${w.name}, ${w.description}, ${country?.id ?? null}, ${course?.id ?? null}, ${w.isDefault ?? false})
          on conflict (name) do nothing returning id`
        if (!inserted.length) continue
        const wid = inserted[0].id
        let i = 10
        for (const s of w.stages) {
          await tx`insert into workflow_stages (workflow_id, stage_key, sort_order) values (${wid}, ${s}, ${i})`
          i += 10
        }
        for (const d of w.documents) {
          await tx`insert into document_requirements (workflow_id, document_type_id, is_required)
                   select ${wid}, id, true from document_types where key = ${d}`
        }
      }
    })
    log('Provisioning complete: organizations, roles, reference data and workflows are in place.')
  } finally {
    await sql.end()
  }
}
