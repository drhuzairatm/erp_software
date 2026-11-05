import Link from 'next/link'
import { fmtDateTime, label } from '@/components/format'
import { Alert, Badge, Card } from '@/components/ui'
import type { Ctx } from '@/services/base'
import { getLookups } from '@/services/lookups'
import { type PreferenceRequirements, studentPreferences } from '@/services/preferences'
import { ClearPreferenceButton, PreferenceForm } from './preference-forms'

const STATUS: Record<string, [string, 'green' | 'amber' | 'slate']> = { meets: ['Meets', 'green'], ok: ['Meets', 'green'], below: ['Below', 'amber'], missing: ['Not recorded', 'amber'], not_comparable: ['Check manually', 'slate'], manual_review: ['Check manually', 'slate'] }
const tag = (s: string | null | undefined) => { const [t, tone] = STATUS[s ?? ''] ?? [label(s), 'slate' as const]; return <Badge tone={tone}>{t}</Badge> }

function Requirements({ r }: { r: PreferenceRequirements | null | undefined }) {
  if (!r) return null
  const empty = !r.advisories.length && !r.university_documents.length && !r.country_documents.length && !r.passport.length
  if (empty) return <p className="hint mt-2">No requirements are configured for this choice. That does not mean there are none: check with the university.</p>
  return (
    <div className="mt-3 space-y-3 text-sm">
      {r.advisories.map((a, i) => (
        <div key={i} data-testid="pref-advisory" className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="font-semibold wrap-anywhere">{a.title}</p><p className="mt-1 wrap-anywhere">{a.message}</p>
          {!!a.items?.length && <ul className="mt-2 space-y-1">{a.items.map((x, j) => <li key={j} className="flex flex-wrap items-center gap-2"><span>{x.subject}: {x.min_percentage != null ? `${x.min_percentage}% or above` : `${x.min_marks} marks or above`}{x.actual != null ? `, recorded ${x.actual}` : ''}</span>{tag(x.result)}</li>)}</ul>}
        </div>))}
      {r.country_documents.length > 0 && <div><p className="font-semibold">Country documents</p><ul className="mt-1 space-y-1">{r.country_documents.map((d, i) => (
        <li key={i} className="wrap-anywhere" data-testid="pref-country-doc">{d.document}{d.required ? '' : ' (recommended)'}{d.stage ? `, at ${d.stage}` : ''}: {d.status ? label(d.status) : 'not on the checklist yet'}{d.guidance ? `. ${d.guidance}` : ''}
          {d.match === 'mismatch' && <span className="ml-2"><Badge tone="amber">Issuing country differs from the visa application country</Badge></span>}
          {d.match === 'unknown' && <span className="ml-2"><Badge tone="slate">Must match the visa application country: not recorded yet</Badge></span>}
          {d.match === 'match' && <span className="ml-2"><Badge tone="green">Matches the visa application country</Badge></span>}</li>))}</ul></div>}
      {r.university_documents.length > 0 && <div><p className="font-semibold">University documents</p><ul className="mt-1 space-y-1">{r.university_documents.map((d, i) => <li key={i} className="wrap-anywhere" data-testid="pref-university-doc">{d.document}{d.required ? '' : ' (optional)'}{d.conditional ? ' (for some students)' : ''}: {d.status ? label(d.status) : 'not on the checklist yet'}{d.notes ? `. ${d.notes}` : ''}</li>)}</ul></div>}
      {r.passport.length > 0 && <div><p className="font-semibold">Passport validity</p><ul className="mt-1 space-y-1">{r.passport.map((p, i) => <li key={i} className="flex flex-wrap items-center gap-2 wrap-anywhere"><span>{p.rule}: {p.months} months</span>{tag(p.status)}</li>)}</ul></div>}
    </div>
  )
}

export async function PreferencesPanel({ ctx, studentId }: { ctx: Ctx; studentId: string }) {
  const d = await studentPreferences(ctx, studentId)
  if (!d) return null
  const l = d.canEdit ? await getLookups(ctx) : null
  const options = l ? { countries: l.countries.filter((c) => c.is_destination).map((c) => ({ id: c.id, name: c.name })), universities: l.universities.map((u) => ({ id: u.id, name: u.name, country_id: u.country_id })), courses: l.courses.map((c) => ({ id: c.id, name: c.name })), intakes: l.intakes.map((i) => ({ id: i.id, name: i.name, university_id: i.university_id, course_id: i.course_id })), years: d.years } : null
  const line = (x: { country: string | null; university: string | null; programme: string | null; intake: string | null }) => [x.country, x.university, x.programme, x.intake].filter(Boolean).join(' · ') || 'Not chosen yet'
  return (
    <Card title="Preferences">
      <Alert tone="blue">Requirements here are guidance. They do not stop registration, and none is a guarantee of admission or a visa.</Alert>
      <div className="mt-4 space-y-5">
        <section aria-label="Primary preference">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Primary</h3>{d.canEdit && <Link className="text-sm" href={`/students/${studentId}/edit`}>Change on Edit details</Link>}</div>
          <p className="mt-1 text-sm wrap-anywhere">{line(d.primary)}</p>
          <Requirements r={d.primaryRequirements} />
        </section>
        {[2, 3].map((rank) => {
          const o = d.others.find((x) => x.rank === rank)
          return (
            <section key={rank} aria-label={rank === 2 ? 'Secondary preference' : 'Tertiary preference'} className="border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{rank === 2 ? 'Secondary' : 'Tertiary'}</h3>{o && d.canEdit && <ClearPreferenceButton studentId={studentId} rank={rank} />}</div>
              <p className="mt-1 text-sm wrap-anywhere">{o ? `${line(o)}${o.academic_year ? ` · ${o.academic_year}` : ''}` : 'Not chosen yet'}</p>
              {o && <Requirements r={o.requirements} />}
              {options && <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold">{o ? 'Change' : 'Add'}</summary><div className="mt-3"><PreferenceForm key={o?.updated_at?.toString() ?? rank} studentId={studentId} rank={rank} options={options} values={o} /></div></details>}
            </section>)
        })}
        {d.history.length > 0 && <details className="border-t border-slate-100 pt-3" data-testid="pref-history"><summary className="cursor-pointer text-sm font-semibold">Change history</summary><ul className="mt-2 space-y-1 text-xs text-slate-600">{d.history.map((h) => <li key={h.id} className="wrap-anywhere">{fmtDateTime(h.changed_at)} · {h.changer ?? 'Unknown'} · {h.rank === 2 ? 'Secondary' : 'Tertiary'} {h.action === 'merged_in' ? 'moved here by a merge' : h.action === 'merged_duplicate' ? 'already held, recorded by a merge' : h.action}{h.country ? `: ${[h.country, h.university, h.programme].filter(Boolean).join(' · ')}` : ''}</li>)}</ul></details>}
      </div>
    </Card>
  )
}
