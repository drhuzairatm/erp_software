import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { ADVISORY_NOTICES, BONAFIDE_RULES, ONE_AND_SAME_TEMPLATES, BUSINESS_UNIVERSITIES, PASSPORT_VALIDITY_RULES, COUNTRIES, COURSES, DEFAULT_ROLES, DEPARTMENTS, NOTIFICATION_TEMPLATES, DOCUMENT_TYPES, FEE_CATEGORIES, LEAD_SOURCES, ORGANIZATIONS, WORKFLOWS } from './defaults'

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
        // Student portal password account e-mails (sent on staff request / "forgot password"; do not use rules)
        await tx`insert into notification_templates (org_id, name, channel, subject, body)
                 values (${org.id}, 'Portal account set-up', 'email', 'Set your student portal password',
                         ${'Dear {{student_name}},\n\nYour {{company}} student portal account is ready. Open the link below to choose your password:\n\n{{link}}\n\nThe link is valid for 72 hours and can be used once. You can then sign in with your Student ID ({{student_code}}) or this email address.\n\nRegards,\n{{company}}'})
                 on conflict (org_id, name, channel, language) do nothing`
        await tx`insert into notification_templates (org_id, name, channel, subject, body)
                 values (${org.id}, 'Portal password reset', 'email', 'Reset your student portal password',
                         ${'Dear {{student_name}},\n\nWe received a request to reset your {{company}} student portal password. Open the link below to choose a new one:\n\n{{link}}\n\nThe link is valid for 1 hour and can be used once. If you did not ask for this, ignore this message – your password stays the same.\n\nRegards,\n{{company}}'})
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
      for (const [code, name, sort, profile] of COURSES) {
        await tx`insert into courses (code, name, sort_order, academic_profile) values (${code}, ${name}, ${sort}, ${profile}) on conflict (code) do nothing`
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
      // ---- business rules supplied by the MD (installed once; managed in the app afterwards)
      const cid = async (code: string) => (await tx<{ id: string }[]>`select id from countries where code = ${code}`)[0]?.id
      for (const [cc, name, city] of BUSINESS_UNIVERSITIES) {
        await tx`insert into universities (country_id, name, city) select ${await cid(cc)}, ${name}, ${city}
                 where not exists (select 1 from universities where name = ${name})`
      }
      for (const r of PASSPORT_VALIDITY_RULES) {
        await tx`insert into passport_validity_rules (name, stage_key, min_months, enforcement, notes)
                 select ${r.name}, ${r.stage}, ${r.months}, ${r.enforcement}, ${r.notes}
                  where not exists (select 1 from passport_validity_rules where name = ${r.name})`
      }
      for (const n of ADVISORY_NOTICES) {
        const country = await cid(n.country)
        if ((await tx`select 1 from advisory_notices where destination_country_id = ${country} and category = 'academic_marks'
                       and university_id is null and course_id is null and status <> 'superseded'`).length) continue
        const id = randomUUID(); const group = randomUUID()
        await tx`insert into advisory_notices (id, notice_group_id, category, display_type, priority, destination_country_id, title, message, notes)
                 values (${id}, ${group}, 'academic_marks', ${n.displayType}, ${n.priority}, ${country}, ${n.title}, ${n.message}, ${n.notes})`
        for (const [k, it] of n.items.entries()) {
          await tx`insert into advisory_notice_items (notice_id, subject_key, subject_name, min_percentage, sort_order)
                   values (${id}, ${it.subject_key}, ${it.subject_name}, ${it.min_percentage}, ${(k + 1) * 10})`
        }
        await tx`insert into advisory_notice_events (notice_group_id, notice_id, version, action, reason, current)
                 values (${group}, ${id}, 1, 'created', 'Installed from the business brief', app.advisory_snapshot(${id}))`
      }
      for (const t of ONE_AND_SAME_TEMPLATES) {
        if ((await tx`select 1 from one_and_same_templates where name = ${t.name}`).length) continue
        await tx`insert into one_and_same_templates (name, body, status, approved_at) values (${t.name}, ${t.body}, 'approved', now())`
      }
      for (const b of BONAFIDE_RULES) {
        const [existing] = await tx<{ id: string; status: string }[]>`select id, status from verification_rules where name = ${b.name} order by version desc limit 1`
        if (existing) {
          // MD approval recorded in the defaults: approve the installed draft once (later versions are managed in the app)
          if (b.approved && existing.status === 'draft' && !(await tx`select 1 from verification_rules where name = ${b.name} and status <> 'draft'`).length) {
            await tx`select set_config('app.rule_change', 'on', true)`
            await tx`update verification_rules set status = 'approved', effective_from = current_date, approved_at = now(), description = ${b.description} where id = ${existing.id}`
            await tx`select set_config('app.rule_change', 'off', true)`
          }
          continue
        }
        const [r] = await tx<{ id: string }[]>`
          insert into verification_rules (name, description, document_type_id, previous_education_country_id, destination_country_id, university_id, conditions)
          values (${b.name}, ${b.description}, (select id from document_types where key = 'bonafide_certificate'), ${await cid(b.previousEducation)},
                  ${await cid(b.destination)}, (select id from universities where name = ${b.university} limit 1),
                  ${b.nationality ? tx.json({ all: [{ field: 'nationality', op: 'in', values: [await cid(b.nationality)] }] }) : null}) returning id`

        for (const [k, [kind, text, mandatory, keywords]] of b.requirements.entries()) {
          await tx`insert into verification_requirements (rule_id, sort_order, kind, text, keywords, is_mandatory)
                   values (${r.id}, ${(k + 1) * 10}, ${kind}, ${text}, ${tx.array(keywords)}::text[], ${mandatory})`
        }
        if (b.approved) {
          await tx`select set_config('app.rule_change', 'on', true)`
          await tx`update verification_rules set status = 'approved', effective_from = current_date, approved_at = now() where id = ${r.id}`
          await tx`select set_config('app.rule_change', 'off', true)`
        }
      }
    })
    log('Provisioning complete: organizations, roles, reference data and workflows are in place.')
  } finally {
    await sql.end()
  }
}
