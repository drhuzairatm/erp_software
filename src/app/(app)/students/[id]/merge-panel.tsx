'use client'

import { useMemo, useState, useTransition } from 'react'
import { checkMergeAction } from '@/app/actions/merge'
import { mergeFilename } from '@/lib/merge-filename'

type Doc = { document_id: string; file_id: string; name: string; category: string; filename: string; mime: string; size: number; version: number; uploaded_at: string; uploader: string; status: string }
type Check = { ok: boolean; filename: string; pages: number; unapproved: number; passportMissing: boolean; error?: string
  items: { file_id: string; name: string; pages: number | null; error: string | null; warning: string | null }[] }
const PURPOSES: [string, string][] = [['university_admission', 'University admission'], ['visa_application', 'Visa application'], ['embassy_submission', 'Embassy submission'], ['general', 'General document package']]
const FORMAT: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' }

export function MergePanel({ studentId, docs, student, canSeePassport, universities, history }: {
  studentId: string; docs: Doc[]; student: { full_name: string; student_code: string; passport_number: string | null; university_id: string | null }
  canSeePassport: boolean; universities: { id: string; name: string }[]
  history: { id: string; filename: string; university: string | null; purpose: string; pages: number | null; outcome: string; mode: string; source_files: string[]; created_at: string; by: string }[]
}) {
  const [order, setOrder] = useState<string[]>([])
  const [uni, setUni] = useState(student.university_id ?? '')
  const [purpose, setPurpose] = useState('university_admission')
  const [check, setCheck] = useState<{ key: string; result: Check } | null>(null)
  const [allowUnapproved, setAllowUnapproved] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [checking, startCheck] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const byId = useMemo(() => Object.fromEntries(docs.map((d) => [d.file_id, d])), [docs])
  const key = `${order.join(',')}|${uni}|${purpose}`
  const ready = check && check.key === key && check.result.ok
  const filename = mergeFilename(student.full_name, student.passport_number, universities.find((u) => u.id === uni)?.name ?? null, student.student_code)
  const unapproved = order.filter((id) => byId[id]?.status !== 'approved').length

  const toggle = (id: string) => setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))
  const move = (i: number, d: number) => setOrder((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n })
  const dropOn = (target: string) => setOrder((o) => {
    if (!dragging || dragging === target) return o
    const n = o.filter((x) => x !== dragging); n.splice(n.indexOf(target), 0, dragging); return n
  })
  const hidden = (
    <>
      {order.map((id) => <input key={id} type="hidden" name="files" value={id} />)}
      <input type="hidden" name="universityId" value={uni} /><input type="hidden" name="purpose" value={purpose} />
    </>
  )

  if (!docs.length) return <p className="text-sm text-slate-600">No uploaded documents yet.</p>
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Uploaded documents</h3>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOrder(docs.map((d) => d.file_id))}>Select all</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOrder([])}>Deselect all</button>
          </div>
          <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {docs.map((d) => (
              <li key={d.file_id}>
                <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${order.includes(d.file_id) ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="checkbox" className="mt-1" checked={order.includes(d.file_id)} onChange={() => toggle(d.file_id)} aria-label={`Include ${d.name}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium">{d.name}
                      <span className={`rounded-full px-1.5 text-[10px] font-semibold ${d.status === 'approved' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'}`}>{d.status.replace(/_/g, ' ')}</span></span>
                    <span className="block truncate text-xs text-slate-500">{FORMAT[d.mime] ?? d.mime} · {d.filename} · v{d.version} · {new Date(d.uploaded_at).toLocaleDateString('en-GB')} · {d.uploader} · {(d.size / 1024).toFixed(0)} KB</span>
                  </span>
                </label>
              </li>))}
          </ul>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2"><h3 className="text-sm font-semibold">Order in the PDF ({order.length})</h3>
            {order.length > 0 && <button type="button" className="btn-ghost btn-sm" onClick={() => setOrder([])}>Clear selection</button>}</div>
          {order.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">Tick documents on the left. Drag them, or use ↑ ↓, to set the order.</p> : (
            <ol className="space-y-1.5" aria-label="Order in the PDF">
              {order.map((id, i) => {
                const d = byId[id]; const c = check?.key === key ? check.result.items.find((x) => x.file_id === id) : null
                return (
                  <li key={id} draggable onDragStart={() => setDragging(id)} onDragOver={(e) => e.preventDefault()} onDrop={() => { dropOn(id); setDragging(null) }} onDragEnd={() => setDragging(null)}
                    className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm ${c?.error ? 'border-red-300 bg-red-50' : 'border-slate-200'} ${dragging === id ? 'opacity-50' : ''}`}>
                    <span aria-hidden className="cursor-grab text-slate-400">⠿</span>
                    <span className="w-5 text-xs font-semibold text-slate-500">{i + 1}.</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d?.name}</span>
                      {c && <span className={`block text-xs ${c.error ? 'text-red-700' : 'text-slate-500'}`}>{c.error ?? `${c.pages} page(s)`}{c.warning && !c.error && <span className="text-amber-700"> · {c.warning}</span>}</span>}</span>
                    <button type="button" className="btn-ghost btn-sm px-2" aria-label={`Move ${d?.name} up`} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" className="btn-ghost btn-sm px-2" aria-label={`Move ${d?.name} down`} onClick={() => move(i, 1)} disabled={i === order.length - 1}>↓</button>
                  </li>)
              })}
            </ol>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div><label className="label" htmlFor="mg-uni">University for this submission</label>
          <select className="input" id="mg-uni" value={uni} onChange={(e) => setUni(e.target.value)}>
            <option value="">No university</option>{universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label className="label" htmlFor="mg-purpose">Purpose</label>
          <select className="input" id="mg-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}>{PURPOSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><p className="label">File name</p><p className="break-all rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium ring-1 ring-slate-200">{filename}</p>
          {!student.passport_number && <p className="hint text-amber-800">{canSeePassport ? 'No passport number recorded – it is left out of the name.' : 'Your role cannot see passport numbers – it is left out of the name.'}</p>}</div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" disabled={!order.length || checking} aria-busy={checking}
          onClick={() => startCheck(async () => {
            const fd = new FormData()
            order.forEach((id) => fd.append('files', id)); fd.set('universityId', uni); fd.set('purpose', purpose)
            const res = await checkMergeAction(studentId, { ok: false }, fd)
            const r = res.data?.check as Check | undefined
            setCheck(r ? { key, result: r } : null)
            setMessage({ ok: res.ok, text: res.message ?? '' })
          })}>{checking ? 'Checking…' : '1. Check documents'}</button>
        {order.length === 0 && <span className="text-xs text-slate-500">Select documents first.</span>}
        {message && (!check || check.key === key) && <span role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-emerald-800' : 'text-red-700'}`}>{message.text}</span>}
      </div>

      {check && check.key !== key && <p className="text-sm text-amber-800">The selection changed – check again before downloading.</p>}
      {ready && (
        <form method="post" action={`/api/students/${studentId}/merge`} className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
          {hidden}
          <p className="text-sm text-emerald-900">Ready: {check.result.items.length} document(s), {check.result.pages} page(s). Originals are not changed and the combined PDF is not stored.</p>
          {unapproved > 0 && (
            <label className="flex items-start gap-2 text-sm text-amber-900"><input type="checkbox" name="allowUnapproved" value="yes" checked={allowUnapproved} onChange={(e) => setAllowUnapproved(e.target.checked)} className="mt-1" />
              {unapproved} selected document(s) are not approved. I confirm they may be included (their status does not change).</label>)}
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="mode" value="preview" formTarget="_blank" className="btn-secondary" disabled={unapproved > 0 && !allowUnapproved}>Preview PDF</button>
            <button type="submit" name="mode" value="download" className="btn-primary" disabled={unapproved > 0 && !allowUnapproved}>2. Download Combined PDF</button>
          </div>
        </form>
      )}

      {history.length > 0 && (
        <details className="rounded-xl border border-slate-200 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Generated submission PDFs ({history.length})</summary>
          <p className="hint mt-1">Combined PDFs are not stored; each line records what was generated. &quot;Use again&quot; reloads the same selection if the files are still current.</p>
          <ul className="mt-2 divide-y divide-slate-100">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-medium">{h.filename}</span>
                  <span className="block text-xs text-slate-500">{new Date(h.created_at).toLocaleString('en-GB')} · {h.by} · {PURPOSES.find(([v]) => v === h.purpose)?.[1]} · {h.pages ?? 0} pages · {h.mode}{h.outcome === 'failure' && ' · failed'}</span></span>
                {h.source_files.every((f) => byId[f]) && <button type="button" className="btn-ghost btn-sm" onClick={() => { setOrder(h.source_files); setUni(universities.find((u) => u.name === h.university)?.id ?? ''); setPurpose(h.purpose) }}>Use again</button>}
              </li>))}
          </ul>
        </details>
      )}
    </div>
  )
}
