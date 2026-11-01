import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { fmtDate } from '@/components/format'
import { BrandMark } from '@/components/brand-mark'
import { RadialProgress } from '@/components/charts'
import { Icon } from '@/components/icons'
import { brandOf } from '@/lib/brands'
import { portalChoices, portalOverview, portalSession, portalShipments } from '@/server/portal'
import { logoutAction } from '../actions'
import { ChooseButton, CourierDetailsForm, PortalUpload } from '../forms'

export const metadata: Metadata = { title: 'My application' }

const COURIER_STATE: Record<string, [string, string]> = {
  instructions_issued: ['Please send', 'bg-amber-100 text-amber-900'], dispatched: ['Sent – on the way', 'bg-violet-100 text-violet-900'],
  in_transit: ['On the way', 'bg-violet-100 text-violet-900'], received: ['Received – being checked', 'bg-blue-100 text-blue-900'],
  reconciliation_required: ['Being checked', 'bg-blue-100 text-blue-900'], completed: ['Received and checked', 'bg-green-100 text-green-900'],
}
const DOC_STATE: Record<string, [string, string]> = {
  missing: ['Please upload', 'bg-amber-100 text-amber-900'],
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
  const shipments = await portalShipments(session.tokenHash)
  const s = o.student
  const brand = brandOf(o.company.code)
  const toUpload = o.documents.filter((d) => d.can_upload && d.required)
  const checking = o.documents.filter((d) => d.state === 'checking')
  const approved = o.documents.filter((d) => d.state === 'approved')
  const other = o.documents.filter((d) => !toUpload.includes(d) && !checking.includes(d) && !approved.includes(d))
  const required = o.documents.filter((d) => d.required)
  const doneStages = o.stages.filter((x) => x.state === 'done').length
  const progress = o.stages.length ? Math.round(((doneStages + (s.status === 'completed' ? 0 : 0.5)) / o.stages.length) * 100) : 0
  const docItem = (d: (typeof o.documents)[number]) => {
    const [label, cls] = DOC_STATE[d.state] ?? [d.state, 'bg-slate-100 text-slate-700']
    return (
      <li key={d.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon name="doc" className="h-4 w-4 text-slate-400" />{d.name}
            {!d.required && <span className="font-normal text-slate-500">(if applicable)</span>}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
        </div>
        {d.reason && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Reason: {d.reason}</p>}
        {d.attestation && (
          <p className="mt-2 text-sm text-slate-700">{d.attestation.state === 'completed' ? '✓ Attestation / apostille completed'
            : `Attestation / apostille in progress: step ${Math.min(d.attestation.done + 1, d.attestation.total)} of ${d.attestation.total}`}</p>
        )}
        {d.can_upload && <PortalUpload documentId={d.id} />}
      </li>
    )
  }
  return (
    <div data-brand={brand} className="min-h-screen bg-[#f3f6fb] pb-16">
      <header className="bg-hero text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <div><BrandMark brand={brand} /><p className="mt-0.5 text-xs text-cyan-brand">Student portal</p></div>
          <form action={logoutAction}><button className="btn border border-white/25 bg-white/10 text-white hover:bg-white/20 btn-sm" type="submit">Sign out</button></form>
        </div>
        <div className="mx-auto max-w-3xl px-4 pb-20 pt-2">
          <p className="text-sm text-slate-300">Hello,</p>
          <h1 className="text-2xl font-bold tracking-tight">{s.name}</h1>
          <p className="mt-1 font-mono text-xs text-slate-300">Student ID {s.code}</p>
        </div>
      </header>

      <main className="mx-auto -mt-16 max-w-3xl space-y-5 px-4">
        {uploaded && <p role="status" className="flex gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 shadow-sm"><Icon name="check" className="h-5 w-5 text-green-600" />Thank you – we received your document and will check it. You will see the result here.</p>}
        <section className="card p-5" aria-labelledby="progress-h">
          <div className="flex items-center gap-5">
            <RadialProgress value={progress} label="Overall progress" size={104} color="#24E0B8" />
            <div className="min-w-0 flex-1">
              <h2 id="progress-h" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current stage</h2>
              <p className="mt-0.5 text-lg font-bold text-slate-900">{s.stage}</p>
              {s.status === 'on_hold' && <span className="mt-1 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">On hold – your counsellor will contact you</span>}
              <p className="mt-1 text-sm text-slate-600">{[s.course, s.destination].filter(Boolean).join(' in ') || 'Programme to be confirmed'}{s.university && ` · ${s.university}`}</p>
            </div>
          </div>
          {s.next_action && (
            <div className="mt-4 flex gap-3 rounded-2xl bg-gradient-to-r from-brand-50 to-cyan-50 px-4 py-3 text-sm text-slate-800">
              <Icon name="flag" className="h-5 w-5 text-brand-600" />
              <p><strong>Next step:</strong> {s.next_action}{s.next_action_due && <span className="text-slate-600"> · by {fmtDate(s.next_action_due)}</span>}</p>
            </div>
          )}
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-amber-50 py-2.5"><dt className="text-[11px] font-medium text-amber-900">Needed from you</dt><dd className="text-xl font-bold text-amber-900">{toUpload.length}</dd></div>
            <div className="rounded-xl bg-blue-50 py-2.5"><dt className="text-[11px] font-medium text-blue-900">Being checked</dt><dd className="text-xl font-bold text-blue-900">{checking.length}</dd></div>
            <div className="rounded-xl bg-green-50 py-2.5"><dt className="text-[11px] font-medium text-green-900">Approved</dt><dd className="text-xl font-bold text-green-900">{approved.filter((d) => d.required).length}/{required.length}</dd></div>
          </dl>
        </section>

        <section className="card p-5" aria-labelledby="track-h">
          <h2 id="track-h" className="text-base font-semibold">Application progress</h2>
          <ol className="mt-4">
            {o.stages.map((st, i) => (
              <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                {i < o.stages.length - 1 && <span aria-hidden className={`absolute left-[13px] top-7 h-[calc(100%-20px)] w-0.5 ${st.state === 'done' ? 'bg-teal-brand' : 'bg-slate-200'}`} />}
                <span aria-hidden className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  st.state === 'done' ? 'bg-teal-brand text-navy-950' : st.state === 'current' ? 'bg-brand-600 text-white ring-4 ring-brand-100' : 'border-2 border-slate-200 bg-white text-slate-400'}`}>
                  {st.state === 'done' ? '✓' : i + 1}</span>
                <span className={`pt-1 text-sm ${st.state === 'upcoming' ? 'text-slate-500' : st.state === 'current' ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
                  {st.name}{st.state === 'current' && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">You are here</span>}</span>
                <span className="sr-only">{st.state === 'done' ? '(completed)' : st.state === 'current' ? '(current stage)' : '(upcoming)'}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card border-l-4 border-l-blue-500 p-5 text-sm" aria-labelledby="ins-h">
          <h2 id="ins-h" className="flex items-center gap-2 font-semibold"><Icon name="book" className="h-5 w-5 text-blue-600" />Important instructions</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-slate-700">
            <li>Upload clear scans of every page — for cards and certificates, include both the front and the back.</li>
            <li>PDF or photo (JPEG/PNG), up to 10 MB. Make sure all text is readable.</li>
            <li>Please do not send original documents until we confirm that your scans are approved. The courier instructions will then appear on this page.</li>
          </ul>
        </section>

        {shipments.length > 0 && (
          <section aria-labelledby="courier-h" className="space-y-3">
            <h2 id="courier-h" className="flex items-center gap-2 px-1 text-base font-semibold"><Icon name="truck" className="h-5 w-5 text-slate-500" />Sending your original documents</h2>
            {shipments.map((sh) => {
              const st = COURIER_STATE[sh.status] ?? [sh.status, 'bg-slate-100 text-slate-700']
              return (
                <div key={sh.id} className="card space-y-3 p-5 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900">{sh.documents.join(', ')}</p>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st[1]}`}>{st[0]}</span>
                  </div>
                  <p className="text-slate-600">Your scans of these documents are approved. Please send the originals by courier to:</p>
                  <address className="whitespace-pre-line rounded-xl bg-slate-50 px-4 py-3 not-italic text-slate-900">{sh.address}</address>
                  {sh.instructions && <p className="rounded-xl bg-blue-50 px-4 py-3 text-blue-950">{sh.instructions}</p>}
                  {sh.received_at ? <p className="text-green-800">✓ Received at our office on {fmtDate(sh.received_at)}.</p>
                    : sh.courier_company && <p className="text-slate-700">Courier: <strong>{sh.courier_company}</strong> · tracking <span className="font-mono">{sh.tracking_number}</span>{sh.dispatch_date && ` · sent ${fmtDate(sh.dispatch_date)}`}</p>}
                  {['instructions_issued', 'dispatched'].includes(sh.status) && (
                    <div className="border-t border-slate-100 pt-3">
                      <p className="mb-2 font-medium text-slate-800">{sh.courier_company ? 'Need to correct the courier details?' : 'After sending, tell us the courier details'}</p>
                      <CourierDetailsForm shipmentId={sh.id} company={sh.courier_company} tracking={sh.tracking_number} />
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )}

        <section aria-labelledby="docs-h" className="space-y-3">
          <h2 id="docs-h" className="px-1 text-base font-semibold">Your documents</h2>
          {toUpload.length > 0 && <><h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-amber-800">Needed from you</h3><ul className="space-y-3">{toUpload.map(docItem)}</ul></>}
          {other.length > 0 && <ul className="space-y-3">{other.map(docItem)}</ul>}
          {checking.length > 0 && <><h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-blue-800">Being checked</h3><ul className="space-y-3">{checking.map(docItem)}</ul></>}
          {approved.length > 0 && <><h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-green-800">Approved</h3><ul className="space-y-3">{approved.map(docItem)}</ul></>}
          {o.documents.length === 0 && <p className="card p-5 text-sm text-slate-600">Nothing is needed from you right now.</p>}
        </section>

        <section className="card p-5 text-sm">
          <h2 className="flex items-center gap-2 font-semibold"><Icon name="wallet" className="h-5 w-5 text-slate-500" />Payments</h2>
          <p className="mt-1 text-slate-600">Payment details are shared by your counsellor. Please contact them for fee information.</p>
        </section>

        <section className="card p-5 text-sm">
          <h2 className="flex items-center gap-2 font-semibold"><Icon name="phone" className="h-5 w-5 text-slate-500" />Questions?</h2>
          <p className="mt-1 text-slate-600">Contact your counsellor{s.counsellor ? ` ${s.counsellor}` : ''} at {o.company.name}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {o.company.support_phone && <a className="btn-secondary btn-sm" href={`tel:${o.company.support_phone.replace(/\s/g, '')}`}><Icon name="phone" className="h-4 w-4" />{o.company.support_phone}</a>}
            {o.company.support_email && <a className="btn-secondary btn-sm" href={`mailto:${o.company.support_email}`}><Icon name="mail" className="h-4 w-4" />{o.company.support_email}</a>}
          </div>
        </section>
      </main>
    </div>
  )
}
