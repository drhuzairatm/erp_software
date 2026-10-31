import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { fmtDate } from '@/components/format'
import { portalChoices, portalOverview, portalSession } from '@/server/portal'
import { logoutAction } from '../actions'
import { ChooseButton, PortalUpload } from '../forms'

export const metadata: Metadata = { title: 'My application' }

const DOC_STATE: Record<string, [string, string]> = {
  missing: ['Please upload', 'bg-slate-100 text-slate-700'],
  checking: ['Received – being checked', 'bg-blue-50 text-blue-800'],
  changes_required: ['Please upload a corrected copy', 'bg-amber-50 text-amber-900'],
  rejected: ['Not accepted – please upload again', 'bg-red-50 text-red-800'],
  approved: ['Approved', 'bg-green-50 text-green-800'],
  expired: ['Expired – please upload a new one', 'bg-red-50 text-red-800'],
}

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ uploaded?: string }> }) {
  const { uploaded } = await searchParams
  const session = await portalSession()
  if (!session) redirect('/portal')
  if (!session.active_student_id) {
    const choices = await portalChoices(session.tokenHash)
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <div className="card space-y-3 p-6">
          <h1 className="text-xl font-semibold">Which application?</h1>
          <p className="text-sm text-slate-600">You are registered with more than one of our companies.</p>
          {choices.map((c) => <ChooseButton key={c.student_id} studentId={c.student_id} label={`${c.company} · ${c.student_code}`} />)}
        </div>
      </main>
    )
  }
  const o = await portalOverview(session.tokenHash)
  if (!o) redirect('/portal')
  const s = o.student
  const toUpload = o.documents.filter((d) => d.can_upload && d.required).length
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div><p className="text-xs font-semibold uppercase tracking-wider text-brand-700">{o.company.name}</p><p className="text-sm font-medium">Student portal</p></div>
          <form action={logoutAction}><button className="btn-secondary btn-sm" type="submit">Sign out</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {uploaded && <p role="status" className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">Thank you – we received your document and will check it. You will see the result here.</p>}
        <section className="card p-5">
          <p className="text-sm text-slate-600">Hello,</p>
          <h1 className="text-xl font-semibold">{s.name}</h1>
          <p className="mt-1 font-mono text-xs text-slate-500">Student ID {s.code}</p>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Programme</dt><dd>{[s.course, s.destination].filter(Boolean).join(' in ') || '—'}{s.university && <span className="block">{s.university}</span>}</dd></div>
            <div><dt className="text-slate-500">Your counsellor</dt><dd>{s.counsellor ?? '—'}</dd></div>
          </dl>
        </section>

        <section className="card p-5" aria-labelledby="progress-h">
          <h2 id="progress-h" className="font-semibold">Application progress</h2>
          <p className="mt-1 text-sm">Current stage: <strong>{s.stage}</strong>
            {s.status === 'on_hold' && <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-900">On hold – your counsellor will contact you</span>}</p>
          {s.next_action && (
            <p className="mt-2 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">Next step: {s.next_action}{s.next_action_due && ` (by ${fmtDate(s.next_action_due)})`}</p>
          )}
          <ol className="mt-4 space-y-2">
            {o.stages.map((st, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${st.state === 'done' ? 'bg-green-600 text-white' : st.state === 'current' ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  {st.state === 'done' ? '✓' : i + 1}</span>
                <span className={st.state === 'upcoming' ? 'text-slate-500' : st.state === 'current' ? 'font-semibold' : ''}>{st.name}</span>
                <span className="sr-only">{st.state === 'done' ? '(completed)' : st.state === 'current' ? '(current stage)' : '(upcoming)'}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card p-5" aria-labelledby="docs-h">
          <h2 id="docs-h" className="font-semibold">Your documents</h2>
          <p className="mt-1 text-sm text-slate-600">{toUpload ? `${toUpload} required document${toUpload === 1 ? '' : 's'} still needed from you.` : 'Nothing is needed from you right now.'}
            {' '}PDF or photo (JPEG/PNG), up to 10 MB. Please make sure every page is clear and readable.</p>
          <ul className="mt-4 divide-y divide-slate-100">
            {o.documents.map((d) => {
              const [label, cls] = DOC_STATE[d.state] ?? [d.state, 'bg-slate-100 text-slate-700']
              return (
                <li key={d.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{d.name}{!d.required && <span className="font-normal text-slate-500"> (if applicable)</span>}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>
                  </div>
                  {d.reason && <p className="mt-1 text-sm text-amber-900">Reason: {d.reason}</p>}
                  {d.can_upload && <PortalUpload documentId={d.id} />}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="card p-5 text-sm">
          <h2 className="font-semibold">Questions?</h2>
          <p className="mt-1 text-slate-600">Contact your counsellor{s.counsellor ? ` ${s.counsellor}` : ''} at {o.company.name}
            {o.company.support_phone && <> · <a href={`tel:${o.company.support_phone.replace(/\s/g, '')}`}>{o.company.support_phone}</a></>}
            {o.company.support_email && <> · <a href={`mailto:${o.company.support_email}`}>{o.company.support_email}</a></>}.</p>
        </section>
      </main>
    </>
  )
}
