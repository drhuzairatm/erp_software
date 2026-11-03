'use client'

import { useMemo, useState } from 'react'
import { annotationAction, documentActionAction, verificationAction } from '@/app/actions/documents'
import { ActionForm, SubmitButton } from '@/components/forms'
import type { ReviewRequirement } from '@/services/documents'
import { type Annotation, normaliseText, PdfViewer, type Selection } from './pdf-viewer'

export interface WorkspaceProps {
  studentId: string
  docId: string
  status: string
  file: { id: string; version: number; mime_type: string; original_filename: string } | null
  isCurrentFile: boolean
  requirements: ReviewRequirement[]
  annotations: Annotation[]
  perms: { review: boolean; approve: boolean; download: boolean }
  me: string
  verifiedBy: string | null
  submittedBy: string | null
  unmet: number
}

const RESULT_LABEL: Record<string, [string, string]> = {
  present: ['Present', 'bg-green-50 text-green-800 ring-green-200'],
  absent: ['Missing', 'bg-red-50 text-red-800 ring-red-200'],
  not_applicable: ['Not applicable', 'bg-slate-100 text-slate-700 ring-slate-200'],
}

function termsFor(r: ReviewRequirement) {
  if (r.kind === 'keywords') return r.keywords
  if (r.kind === 'manual_check') return []
  return [r.text]
}

export function ReviewWorkspace(p: WorkspaceProps) {
  const [page, setPage] = useState(1)
  const [pageTexts, setPageTexts] = useState<string[] | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [focusReq, setFocusReq] = useState<string | null>(null)
  const isPdf = p.file?.mime_type === 'application/pdf'
  const contentUrl = p.file ? `/api/files/${p.file.id}/content` : null
  const canVerify = p.perms.review && p.isCurrentFile && ['uploaded', 'under_review'].includes(p.status)

  // Detection hints: where each requirement's wording/keywords appear (in-browser only, never decisive)
  const hints = useMemo(() => {
    const out: Record<string, { pages: number[]; missingKeywords: string[] } | null> = {}
    for (const r of p.requirements) {
      if (!pageTexts || r.kind === 'manual_check') { out[r.id] = null; continue }
      if (r.kind === 'keywords') {
        const kws = r.keywords.map(normaliseText)
        const pages = pageTexts.flatMap((t, i) => (kws.every((k) => t.includes(k)) ? [i + 1] : []))
        const all = pageTexts.join(' ')
        out[r.id] = { pages, missingKeywords: r.keywords.filter((k) => !all.includes(normaliseText(k))) }
      } else {
        const phrase = normaliseText(r.text)
        out[r.id] = { pages: pageTexts.flatMap((t, i) => (t.includes(phrase) ? [i + 1] : [])), missingKeywords: [] }
      }
    }
    return out
  }, [pageTexts, p.requirements])

  const highlightTerms = useMemo(() => {
    const r = p.requirements.find((x) => x.id === focusReq)
    return r ? termsFor(r) : []
  }, [focusReq, p.requirements])

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <div className="card h-[80vh] overflow-hidden xl:col-span-3">
        {!p.file ? <p className="p-6 text-sm text-slate-600">No file has been uploaded yet.</p>
          : isPdf ? (
            <PdfViewer url={contentUrl!} annotations={p.annotations} highlightTerms={highlightTerms} page={page}
              onPageChange={setPage} onTextExtracted={setPageTexts} onSelection={setSelection} />
          ) : <ImageViewer url={contentUrl!} />}
      </div>

      <div className="space-y-4 xl:col-span-2">
        {!p.isCurrentFile && (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            You are viewing an older version. Verification and approval apply only to the current version.
          </p>
        )}

        <section className="card p-4" aria-labelledby="checklist-h">
          <h2 id="checklist-h" className="mb-1 font-semibold">Verification checklist</h2>
          <p className="mb-3 text-xs text-slate-500">
            {isPdf ? (pageTexts ? 'Highlighting shows where wording was found in the text of the PDF. It is only a hint: read the document and decide yourself.'
              : 'Reading the document text…') : 'Automatic text hints are not available for images. Check visually.'}
          </p>
          {p.requirements.length === 0 ? (
            <p className="text-sm text-slate-600">No verification rules apply to this document (by document type, previous-education country, destination, university and course). Review it visually.</p>
          ) : (
            <ol className="space-y-3">
              {p.requirements.map((r) => {
                const h = hints[r.id]
                const latest = r.latest_result ? RESULT_LABEL[r.latest_result] : null
                return (
                  <li key={r.id} className={`rounded-md border p-3 text-sm ${focusReq === r.id ? 'border-brand-600' : 'border-slate-200'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs text-slate-500">{r.rule_name} · v{r.rule_version} · {r.kind.replace('_', ' ')} {r.is_mandatory ? '· mandatory' : '· optional'}</p>
                        <p className="mt-0.5 font-medium">{r.kind === 'keywords' ? `Keywords: ${r.keywords.join(', ')}` : r.text}</p>
                        {r.kind === 'keywords' && r.text && <p className="text-xs text-slate-600">{r.text}</p>}
                        {r.guidance && <p className="mt-1 text-xs text-slate-600">{r.guidance}</p>}
                      </div>
                      {latest && <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ring-1 ${latest[1]}`}>{latest[0]}</span>}
                    </div>
                    {h && (
                      <p className="mt-2 text-xs">
                        {h.pages.length ? (
                          <>Found on page {h.pages.map((pg, i) => (
                            <button key={pg} type="button" className="text-brand-700 underline" onClick={() => { setPage(pg); setFocusReq(r.id) }}>{pg}{i < h.pages.length - 1 ? ', ' : ''}</button>
                          ))}</>
                        ) : <span className="text-amber-800">Not found in the text{h.missingKeywords.length ? ` (missing: ${h.missingKeywords.join(', ')})` : ''} — scanned documents need a visual check.</span>}
                      </p>
                    )}
                    {r.latest_by && <p className="mt-1 text-xs text-slate-500">Last checked by {r.latest_by}{r.latest_comment ? ` — “${r.latest_comment}”` : ''}</p>}
                    {canVerify && (
                      <ActionForm action={verificationAction.bind(null, p.studentId, p.docId, r.id)} className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="detected" value={h ? (h.pages.length ? 'yes' : 'no') : ''} />
                        <label className="sr-only" htmlFor={`c-${r.id}`}>Comment</label>
                        <input id={`c-${r.id}`} name="comment" className="input min-w-40 flex-1 py-1 text-xs" placeholder="Comment (required if missing)" maxLength={2000} />
                        <SubmitButton name="result" value="present" className="btn-secondary btn-sm" pendingText="…">✓ Present</SubmitButton>
                        <SubmitButton name="result" value="absent" className="btn-secondary btn-sm" pendingText="…">✗ Missing</SubmitButton>
                        {!r.is_mandatory && <SubmitButton name="result" value="not_applicable" className="btn-ghost btn-sm" pendingText="…">N/A</SubmitButton>}
                      </ActionForm>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        <WorkflowPanel {...p} />

        {p.file && (
          <section className="card p-4" aria-labelledby="comments-h">
            <h2 id="comments-h" className="mb-2 font-semibold">Comments on version {p.file.version}</h2>
            {p.annotations.length === 0 ? <p className="text-sm text-slate-500">No comments yet.</p> : (
              <ul className="mb-3 max-h-64 space-y-2 overflow-y-auto">{p.annotations.map((a) => (
                <li key={a.id} className="text-sm">
                  <button type="button" className="text-xs text-brand-700 underline" onClick={() => setPage(a.page)}>Page {a.page}</button>
                  <span className="text-xs text-slate-500"> · {a.author}</span>
                  {a.quote && <blockquote className="border-l-2 border-yellow-400 pl-2 text-xs italic text-slate-600">“{a.quote}”</blockquote>}
                  <p>{a.body}</p>
                </li>))}
              </ul>
            )}
            <ActionForm action={annotationAction.bind(null, p.studentId, p.docId, p.file.id)} resetOnSuccess>
              <input type="hidden" name="page" value={selection?.page ?? page} />
              <input type="hidden" name="rects" value={JSON.stringify(selection?.rects ?? [])} />
              <input type="hidden" name="quote" value={selection?.quote ?? ''} />
              <p className="text-xs text-slate-600">
                {selection ? <>Commenting on selected text on page {selection.page}: “{selection.quote.slice(0, 120)}{selection.quote.length > 120 ? '…' : ''}”</>
                  : <>Comment on page {page}. Select text in the document to highlight it.</>}
              </p>
              <label className="sr-only" htmlFor="ann-body">Comment</label>
              <textarea id="ann-body" name="body" rows={2} className="input" required maxLength={4000} />
              <SubmitButton className="btn-secondary btn-sm">Add comment</SubmitButton>
            </ActionForm>
          </section>
        )}
      </div>
    </div>
  )
}

function WorkflowPanel(p: WorkspaceProps) {
  const ownWork = p.verifiedBy === p.me || p.submittedBy === p.me
  const buttons: { action: string; label: string; reason?: boolean; tone?: string; disabled?: string }[] = []
  if (p.isCurrentFile) {
    if (p.perms.review && p.status === 'uploaded') buttons.push({ action: 'start_review', label: 'Start review' })
    if (p.perms.review && ['uploaded', 'under_review'].includes(p.status)) {
      buttons.push({ action: 'verify', label: 'Mark verified', disabled: p.unmet ? `${p.unmet} mandatory check(s) not yet ticked as present` : undefined })
    }
    if (p.perms.review && p.status === 'verified') buttons.push({ action: 'submit', label: 'Submit for manager approval' })
    if (p.perms.approve && p.status === 'pending_approval') {
      buttons.push({ action: 'approve', label: 'Approve', disabled: ownWork ? 'You verified or submitted this document — another manager must approve it' : p.unmet ? 'Unmet mandatory checks' : undefined })
    }
    const canChange = (['uploaded', 'under_review', 'verified'].includes(p.status) && p.perms.review)
      || (['pending_approval', 'approved'].includes(p.status) && p.perms.approve)
    if (canChange) buttons.push({ action: 'request_changes', label: p.status === 'approved' ? 'Re-open: changes required' : 'Request changes', reason: true, tone: 'btn-secondary' })
    if ((['uploaded', 'under_review', 'verified'].includes(p.status) && p.perms.review) || (p.status === 'pending_approval' && p.perms.approve)) {
      buttons.push({ action: 'reject', label: 'Reject', reason: true, tone: 'btn-danger' })
    }
    if (p.perms.review && p.status === 'approved') buttons.push({ action: 'expire', label: 'Mark expired', reason: true, tone: 'btn-secondary' })
  }
  return (
    <section className="card p-4" aria-labelledby="wf-h">
      <h2 id="wf-h" className="mb-2 font-semibold">Review workflow</h2>
      <p className="mb-3 text-xs text-slate-600">Documentation staff verify every mandatory check and submit; a <strong>different</strong> manager approves. A new upload restarts the process.</p>
      {buttons.length === 0 ? <p className="text-sm text-slate-500">No actions available to you at this stage.</p> : (
        <div className="space-y-2">
          {buttons.map((b) => (
            <ActionForm key={b.action} action={documentActionAction.bind(null, p.studentId, p.docId)} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="action" value={b.action} />
              {b.reason && (<><label className="sr-only" htmlFor={`r-${b.action}`}>Reason</label>
                <input id={`r-${b.action}`} name="reason" className="input min-w-40 flex-1 py-1.5 text-sm" placeholder="Reason (required) – shown to the student" required maxLength={500} /></>)}
              {b.disabled ? (
                <span className="text-xs text-slate-500"><button type="button" className={`${b.tone ?? 'btn-primary'} btn-sm`} disabled>{b.label}</button> {b.disabled}</span>
              ) : <SubmitButton className={`${b.tone ?? 'btn-primary'} btn-sm`}>{b.label}</SubmitButton>}
            </ActionForm>
          ))}
        </div>
      )}
    </section>
  )
}

function ImageViewer({ url }: { url: string }) {
  const [zoom, setZoom] = useState(1)
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-sm">
        <button type="button" className="btn-secondary btn-sm" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} aria-label="Zoom out">−</button>
        <span className="w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom in">+</button>
      </div>
      <div className="flex-1 overflow-auto bg-slate-100 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Uploaded document" style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} className="mx-auto block bg-white shadow" />
      </div>
    </div>
  )
}
