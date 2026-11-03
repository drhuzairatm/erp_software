import type { Metadata } from 'next'
import Link from 'next/link'
import { ConditionBuilder } from '@/components/condition-builder'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { FIELDS, type FieldKey, parseConditions, type Trace } from '@/lib/conditions'
import { requireUser } from '@/lib/auth/session'
import { ServiceError } from '@/lib/errors'
import { canTestRules, conditionOptions, previewCondition, testStudent } from '@/services/rules'

export const metadata: Metadata = { title: 'Rule tester' }

function TraceView({ t }: { t: Trace }) {
  return (
    <div className="text-xs">
      <p className={`flex items-start gap-1.5 ${t.result ? 'text-emerald-800' : 'text-slate-500'}`}>
        <span aria-hidden className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${t.result ? 'bg-emerald-500' : 'bg-slate-300'}`}>{t.result ? '✓' : '✕'}</span>
        <span>{t.text}<span className="sr-only">{t.result ? ' (true)' : ' (false)'}</span></span>
      </p>
      {t.children && t.children.length > 0 && <div className="ml-2 mt-1 space-y-1 border-l border-slate-200 pl-3">{t.children.map((c, i) => <TraceView key={i} t={c} />)}</div>}
    </div>
  )
}

export default async function RuleTesterPage({ searchParams }: { searchParams: Promise<{ student?: string; doc?: string; preview?: string }> }) {
  const ctx = await requireUser()
  if (!canTestRules(ctx)) return <PageHeader title="Rule tester" description="You do not have access to this page." />
  const sp = await searchParams
  const options = await conditionOptions(ctx)
  const tested = sp.student?.trim() ? await testStudent(ctx, sp.student, sp.doc) : undefined
  let previewError: string | null = null
  const preview = sp.preview !== undefined
    ? await previewCondition(ctx, sp.preview).catch((e) => { if (e instanceof ServiceError) { previewError = e.message; return null } throw e })
    : null
  let initial = null
  try { initial = parseConditions(sp.preview ?? null) } catch { initial = null }
  const kinds = tested ? [...new Set(tested.results.map((r) => r.kind))] : []
  return (
    <>
      <PageHeader title="Rule tester" description="See which rules apply to a student and why, or preview how many students a condition would match. Nothing is changed here." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <Card title="Check a student">
            <form method="get" className="flex flex-wrap items-end gap-3">
              <div><label className="label" htmlFor="student">Student ID</label>
                <input className="input font-mono uppercase" id="student" name="student" defaultValue={sp.student} placeholder="EDX-26-001001" required /></div>
              {tested && tested.documents.length > 0 && (
                <div><label className="label" htmlFor="doc">Document (optional)</label>
                  <select className="input" id="doc" name="doc" defaultValue={tested.document ?? ''}><option value="">— student only —</option>
                    {tested.documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
              )}
              <button className="btn-primary" type="submit">Check</button>
            </form>
            {tested === null && <p className="mt-3 text-sm text-red-700">No student with this ID that you can see.</p>}
          </Card>
          {tested && (
            <>
              <Card title={<span>Rules for {tested.student.full_name} <span className="font-mono text-xs text-slate-500">{tested.student.student_code}</span></span>}>
                {tested.results.length === 0 ? <EmptyState title="No active rules to check" /> : (
                  <div className="space-y-5">
                    {kinds.map((k) => (
                      <section key={k} aria-label={k}>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{k}</h3>
                        <ul className="space-y-2">
                          {tested.results.filter((r) => r.kind === k).map((r) => (
                            <li key={r.id} className={`rounded-xl border p-3 ${r.applies ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'}`}>
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div><Link href={r.href} className="text-sm font-semibold">{r.name}</Link><p className="text-xs text-slate-500">{r.scope}</p></div>
                                {r.applies ? <Badge tone="green">Applies</Badge> : <Badge>Does not apply</Badge>}
                              </div>
                              <div className="mt-2 space-y-1">
                                <p className={`text-xs ${r.scopeMatch ? 'text-emerald-800' : 'text-slate-500'}`}>{r.scopeMatch ? '✓ Scope (country, university, course…) matches' : '✕ Scope does not match this student'}</p>
                                <TraceView t={r.trace} />
                              </div>
                            </li>))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
        <div className="space-y-6 xl:col-span-2">
          {tested && (
            <Card title="Facts used by the rules">
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                {Object.entries(FIELDS).map(([k, f]) => {
                  const v = tested.facts.find((x) => x.key === k)?.value
                  const shown = v === undefined ? null : f.kind === 'number' ? String(v) : tested.names[f.kind]?.[String(v)] ?? 'recorded'
                  return (<div key={k}><dt className="text-xs text-slate-500">{FIELDS[k as FieldKey].label}</dt><dd className={shown ? 'font-medium' : 'text-slate-400'}>{shown ?? 'not recorded'}</dd></div>)
                })}
              </dl>
              <p className="hint mt-3">Nationality comes from the current (verified) passport, or its issuing country when nationality is not recorded; age from the date of birth.</p>
            </Card>
          )}
          <Card title="Preview a condition">
            <form method="get" className="space-y-3">
              {sp.student && <input type="hidden" name="student" value={sp.student} />}
              <ConditionBuilder name="preview" initial={initial} options={options} label="Condition" />
              <button className="btn-primary" type="submit">Preview</button>
            </form>
            {previewError && <p className="mt-3 text-sm text-red-700">{previewError}</p>}
            {preview && (
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
                <p className="text-slate-700">{preview.description}</p>
                <p><strong className="text-2xl tabular-nums">{preview.matching}</strong> of {preview.total} active students you can see would match.</p>
                {preview.sample.length > 0 && <ul className="space-y-0.5 text-xs">{preview.sample.map((s) => (
                  <li key={s.id}><Link href={`/students/${s.id}`}>{s.full_name}</Link> <span className="font-mono text-slate-500">{s.student_code}</span></li>))}</ul>}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
