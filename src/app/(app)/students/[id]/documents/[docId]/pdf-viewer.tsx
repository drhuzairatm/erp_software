'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface Rect { x: number; y: number; w: number; h: number }
export interface Annotation { id: string; page: number; rects: Rect[]; quote: string | null; body: string; author: string | null }
export interface Selection { page: number; rects: Rect[]; quote: string }

/** Normalise text for phrase matching: lower-case, unified quotes/dashes, single spaces. */
export function normaliseText(s: string) {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim()
}

/**
 * In-app PDF viewer (pdf.js, served from our own origin): page navigation, zoom,
 * selectable text, comment highlights, and search-term highlighting. Text is
 * extracted in the browser only, to HINT where required wording appears.
 */
export function PdfViewer({ url, annotations, highlightTerms, page, onPageChange, onTextExtracted, onSelection }: {
  url: string
  annotations: Annotation[]
  highlightTerms: string[]
  page: number
  onPageChange: (p: number) => void
  onTextExtracted: (pages: string[]) => void
  onSelection: (s: Selection | null) => void
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1.2)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // Load the document once
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
        const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        if (!res.ok) throw new Error('not allowed')
        const doc = await pdfjs.getDocument({
          data: new Uint8Array(await res.arrayBuffer()), wasmUrl: '/pdfjs/wasm/', standardFontDataUrl: '/pdfjs/standard_fonts/', enableXfa: false,
        }).promise
        if (cancelled) return
        setPdf(doc)
        const texts: string[] = []
        for (let i = 1; i <= doc.numPages; i++) {
          const tc = await (await doc.getPage(i)).getTextContent()
          texts.push(normaliseText(tc.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? ' ' : '') : '')).join(' ')))
        }
        if (!cancelled) onTextExtracted(texts)
      } catch {
        if (!cancelled) setError('This file could not be displayed. It may be damaged or password-protected.')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  // Render the current page
  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    let task: { cancel: () => void } | null = null
    ;(async () => {
      const pdfjs = await import('pdfjs-dist')
      const p = await pdf.getPage(Math.min(Math.max(page, 1), pdf.numPages))
      const viewport = p.getViewport({ scale })
      const canvas = canvasRef.current!
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setSize({ w: viewport.width, h: viewport.height })
      const render = p.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
      task = render
      await render.promise.catch(() => {})
      if (cancelled) return
      const layer = textRef.current!
      layer.replaceChildren()
      layer.style.setProperty('--total-scale-factor', String(scale))
      const tl = new pdfjs.TextLayer({ textContentSource: await p.getTextContent(), container: layer, viewport })
      await tl.render()
      if (cancelled) return
      // Mark text runs that belong to a searched phrase/keyword
      const terms = highlightTerms.map(normaliseText).filter((t) => t.length >= 3)
      for (const div of tl.textDivs) {
        const t = normaliseText(div.textContent ?? '')
        if (t.length >= 3 && terms.some((term) => term.includes(t) || t.includes(term))) div.classList.add('pdf-hit')
      }
    })()
    return () => { cancelled = true; task?.cancel() }
  }, [pdf, page, scale, highlightTerms])

  const captureSelection = useCallback(() => {
    const sel = window.getSelection()
    const box = pageRef.current?.getBoundingClientRect()
    if (!sel || sel.isCollapsed || !box || !textRef.current?.contains(sel.anchorNode)) { onSelection(null); return }
    const rects = Array.from(sel.getRangeAt(0).getClientRects()).slice(0, 50).map((r) => ({
      x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, w: r.width / box.width, h: r.height / box.height,
    }))
    onSelection({ page, rects, quote: sel.toString().replace(/\s+/g, ' ').trim().slice(0, 2000) })
  }, [onSelection, page])

  if (error) return <p role="alert" className="p-6 text-sm text-red-700">{error}</p>
  if (!pdf) return <p role="status" className="p-6 text-sm text-slate-500">Loading document…</p>

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-sm">
        <button type="button" className="btn-secondary btn-sm" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Previous page">‹</button>
        <label className="flex items-center gap-1">Page
          <input className="input w-16 py-1 text-center" type="number" min={1} max={pdf.numPages} value={page}
            onChange={(e) => onPageChange(Math.min(pdf.numPages, Math.max(1, Number(e.target.value) || 1)))} />
          of {pdf.numPages}</label>
        <button type="button" className="btn-secondary btn-sm" onClick={() => onPageChange(Math.min(pdf.numPages, page + 1))} disabled={page >= pdf.numPages} aria-label="Next page">›</button>
        <span className="mx-2 h-5 w-px bg-slate-200" />
        <button type="button" className="btn-secondary btn-sm" onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(1)))} aria-label="Zoom out">−</button>
        <span className="w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(1)))} aria-label="Zoom in">+</button>
        <span className="ml-auto text-xs text-slate-500">Select text to comment on it</span>
      </div>
      <div className="flex-1 overflow-auto bg-slate-100 p-4">
        <div ref={pageRef} className="relative mx-auto bg-white shadow" style={{ width: size.w, height: size.h }} onMouseUp={captureSelection}>
          <canvas ref={canvasRef} className="block" />
          <div ref={textRef} className="textLayer" />
          {annotations.filter((a) => a.page === page).flatMap((a) => a.rects.map((r, i) => (
            <div key={`${a.id}-${i}`} title={`${a.author ?? ''}: ${a.body}`} className="pointer-events-none absolute bg-yellow-300/40 mix-blend-multiply"
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
          )))}
        </div>
      </div>
    </div>
  )
}
