'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export const PHOTO_HELP = 'Upload a recent passport-size photograph with a plain white background, face centred and clearly visible. JPG or PNG, maximum 5 MB.'
const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = 'image/jpeg,image/png'

/** Camera error messages (shown to the user; never fail silently). */
export function cameraErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access is blocked. Allow camera permission for this website in your browser settings. On Mac, also check System Settings > Privacy & Security > Camera.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found. You can upload a photograph from your gallery or files.'
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is currently being used by another application. Close other applications using the camera and try again.'
  if (name === 'InsecureContext') return 'Camera access requires a secure HTTPS connection. Please open the ERP using its secure HTTPS address.'
  return 'The camera could not be started. You can upload a photograph from your gallery or files.'
}

/** Phones and tablets open the native camera; laptops and desktops use the in-app camera window. */
function isTouchDevice() {
  return typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches
}

/** Checks the real file signature, type and size; compresses large images (canvas → JPEG) to stay within 5 MB. */
async function prepareImage(file: File): Promise<File> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
  if (!isJpeg && !isPng) throw new Error('Please choose a JPG or PNG photo. Other files are not accepted.')
  if (file.size <= MAX_BYTES) return file
  // too large: re-encode at a sensible size (the face stays sharp; metadata is dropped)
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('The image could not be read.')); i.src = url })
    for (const [max, q] of [[2400, 0.9], [1800, 0.85], [1400, 0.8]] as const) {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * s); canvas.height = Math.round(img.naturalHeight * s)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', q))
      if (blob && blob.size <= MAX_BYTES) return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
    }
    throw new Error('The photo is larger than 5 MB and could not be reduced. Please choose a smaller photo.')
  } finally { URL.revokeObjectURL(url) }
}

/**
 * PhotoCapture – one reusable photo component for staff and students.
 * Take Photo: native camera on phones/tablets (capture="user"), in-app camera window on laptops/desktops (getUserMedia).
 * Choose from Gallery / Files: never forces the camera. After choosing: preview, Retake / Use Photo, then crop (zoom, drag).
 * Submits the file as `name` and the crop rectangle as `${name}Crop`; the server validates and processes everything again.
 */
export function PhotoCapture({ name = 'photo', onChange, square = false, help = PHOTO_HELP }: { name?: string; onChange?: (chosen: boolean) => void; square?: boolean; help?: string }) {
  const FRAME_W = square ? 220 : 210
  const FRAME_H = square ? 220 : Math.round(210 / (35 / 45))
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<{ file: File; url: string; source: 'camera' | 'native' } | null>(null)
  const [chosen, setChosen] = useState<{ file: File; url: string } | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const formInput = useRef<HTMLInputElement>(null)  // the file that is submitted
  const nativeCam = useRef<HTMLInputElement>(null)  // phones/tablets: capture="user"
  const gallery = useRef<HTMLInputElement>(null)    // gallery/files: no capture attribute

  useEffect(() => () => { if (review) URL.revokeObjectURL(review.url) }, [review])
  useEffect(() => () => { if (chosen) URL.revokeObjectURL(chosen.url) }, [chosen])

  const base = nat ? Math.max(FRAME_W / nat.w, FRAME_H / nat.h) : 1
  const scale = base * zoom
  const clamp = (o: { x: number; y: number }, s = scale) => nat ? ({ x: Math.min(0, Math.max(FRAME_W - nat.w * s, o.x)), y: Math.min(0, Math.max(FRAME_H - nat.h * s, o.y)) }) : o
  const crop = nat ? { x: -off.x / scale, y: -off.y / scale, width: FRAME_W / scale, height: FRAME_H / scale } : null

  const setFormFile = (f: File | null) => {
    if (!formInput.current) return
    const dt = new DataTransfer()
    if (f) dt.items.add(f)
    formInput.current.files = dt.files
  }
  const accept = async (raw: File, source: 'camera' | 'native' | 'gallery') => {
    setError(null)
    try {
      const f = await prepareImage(raw)
      // desktop camera already had its own preview with Retake/Use photo; phones get it here
      if (source === 'native') setReview({ file: f, url: URL.createObjectURL(f), source })
      else commit(f)
    } catch (e) { setError((e as Error).message) }
  }
  const commit = (f: File) => {
    setReview(null)
    setNat(null); setZoom(1)
    setChosen({ file: f, url: URL.createObjectURL(f) })
    setFormFile(f)
    onChange?.(true)
  }
  const reset = () => {
    setReview(null); setChosen(null); setNat(null); setError(null); setFormFile(null)
    if (nativeCam.current) nativeCam.current.value = ''
    if (gallery.current) gallery.current.value = ''
    onChange?.(false)
  }
  const takePhoto = () => {
    setError(null)
    if (isTouchDevice()) { nativeCam.current?.click(); return }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(cameraErrorMessage({ name: window.isSecureContext ? 'NotFoundError' : 'InsecureContext' }))
      return
    }
    setCameraOpen(true)
  }

  return (
    <div className="space-y-3">
      <input ref={formInput} type="file" name={name} accept={ACCEPT} className="hidden" tabIndex={-1} aria-hidden />
      <input ref={nativeCam} type="file" accept={ACCEPT} capture="user" className="hidden" tabIndex={-1} aria-hidden data-testid="photo-camera-input"
        onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) accept(f, 'native'); e.currentTarget.value = '' }} />
      <input ref={gallery} type="file" accept={ACCEPT} className="hidden" tabIndex={-1} aria-label="Choose a photo from the device"
        onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) accept(f, 'gallery'); e.currentTarget.value = '' }} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={takePhoto}>Take photo</button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => gallery.current?.click()}>Choose from gallery / files</button>
        {(chosen || review) && <button type="button" className="btn-ghost btn-sm" onClick={reset}>Cancel / choose another</button>}
      </div>
      <p className="hint">{help}</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {review && (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3" aria-label="Photo preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={review.url} alt="Captured photo preview" className="max-h-64 rounded-lg" />
          <div className="flex gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => { setReview(null); nativeCam.current?.click() }}>Retake</button>
            <button type="button" className="btn-primary btn-sm" onClick={() => commit(review.file)}>Use photo</button>
          </div>
        </div>
      )}

      {chosen && (
        <div className="flex flex-wrap items-start gap-5">
          <div>
            <div className="relative touch-none select-none overflow-hidden rounded-lg bg-slate-200 ring-2 ring-brand-500" style={{ width: FRAME_W, height: FRAME_H, cursor: 'grab' }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y } }}
              onPointerMove={(e) => { const d = drag.current; if (d) setOff(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })) }}
              onPointerUp={() => { drag.current = null }} aria-label="Drag to reposition the photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={chosen.url} alt="Selected photo" draggable={false} className="absolute left-0 top-0 max-w-none"
                style={{ width: nat ? nat.w * scale : undefined, height: nat ? nat.h * scale : undefined, transform: `translate(${off.x}px, ${off.y}px)` }}
                onLoad={(e) => {
                  const w = e.currentTarget.naturalWidth; const h = e.currentTarget.naturalHeight
                  setNat({ w, h })
                  const s = Math.max(FRAME_W / w, FRAME_H / h)
                  setOff({ x: (FRAME_W - w * s) / 2, y: (FRAME_H - h * s) / 2 })
                }} />
              <div aria-hidden className={`pointer-events-none absolute border-2 border-dashed border-white/70 ${square ? 'inset-[6%] rounded-full' : 'inset-x-[22%] top-[14%] h-[52%] rounded-[50%]'}`} />
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">Zoom
              <input type="range" min={1} max={4} step={0.01} value={zoom} className="flex-1"
                onChange={(e) => {
                  const z = Number(e.target.value)
                  const cx = (FRAME_W / 2 - off.x) / scale; const cy = (FRAME_H / 2 - off.y) / scale
                  const s = base * z
                  setZoom(z); setOff(clamp({ x: FRAME_W / 2 - cx * s, y: FRAME_H / 2 - cy * s }, s))
                }} /></label>
            <p className="text-[11px] text-slate-500">Drag to reposition · keep the face inside the oval</p>
          </div>
          <div className="text-center text-xs text-slate-500">
            <div className="mx-auto h-16 w-16 overflow-hidden rounded-full bg-slate-200 ring-1 ring-slate-300">
              {nat && crop && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={chosen.url} alt="" aria-hidden className="max-w-none" style={{
                  width: nat.w * (64 / crop.width), height: nat.h * (64 / crop.width),
                  transform: `translate(${-crop.x * (64 / crop.width)}px, ${-(crop.y + (square ? 0 : crop.height * 0.08)) * (64 / crop.width)}px)` }} />
              )}
            </div>
            <p className="mt-1">Avatar preview</p>
          </div>
        </div>
      )}
      {chosen && crop && <input type="hidden" name={`${name}Crop`} value={JSON.stringify({ x: Math.round(crop.x), y: Math.round(crop.y), width: Math.round(crop.width), height: Math.round(crop.height) })} />}

      {cameraOpen && <CameraDialog onClose={() => setCameraOpen(false)} onPhoto={(f) => { setCameraOpen(false); accept(f, 'camera') }}
        onError={(m) => { setCameraOpen(false); setError(m) }} onFiles={() => { setCameraOpen(false); gallery.current?.click() }} />}
    </div>
  )
}

/** Laptop/desktop camera: live mirrored preview, Capture → still (not mirrored), Retake / Use photo / Cancel. Tracks always stopped. */
function CameraDialog({ onClose, onPhoto, onError, onFiles }: { onClose: () => void; onPhoto: (f: File) => void; onError: (msg: string) => void; onFiles: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const alive = useRef(true)
  const req = useRef(0) // each camera request gets a token; a stream for an outdated request is stopped at once
  const cb = useRef({ onClose, onPhoto, onError, onFiles })
  useEffect(() => { cb.current = { onClose, onPhoto, onError, onFiles } })
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null)
  const [ready, setReady] = useState(false)

  const stop = useCallback(() => {
    req.current++
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }, [])
  /** Opens the camera (front camera, ideal 1280×720); a stream obtained after closing is released at once. */
  const openCamera = useCallback(() => {
    const token = ++req.current
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (s) => {
        if (!alive.current || token !== req.current) { s.getTracks().forEach((t) => t.stop()); return }
        stream.current?.getTracks().forEach((t) => t.stop())
        stream.current = s
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}) }
        setReady(true)
      })
      .catch((e) => { if (token !== req.current) return; stop(); if (alive.current) cb.current.onError(cameraErrorMessage(e)) })
  }, [stop])
  const start = () => { alive.current = true; void openCamera() }

  useEffect(() => {
    alive.current = true
    const d = dialog.current
    if (d && !d.open) d.showModal()
    void openCamera()
    return () => { alive.current = false; stop() }
  }, [openCamera, stop])
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])

  const capture = async () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth; canvas.height = v.videoHeight
    canvas.getContext('2d')!.drawImage(v, 0, 0) // the saved photo is NOT mirrored
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9))
    stop(); setReady(false) // camera light off while reviewing
    if (blob) setShot({ file: new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }), url: URL.createObjectURL(blob) })
  }
  const close = () => { alive.current = false; stop(); dialog.current?.close(); cb.current.onClose() }

  return (
    <dialog ref={dialog} onCancel={(e) => { e.preventDefault(); close() }} aria-label="Take a photo"
      className="m-auto w-[min(94vw,40rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-black/70">
      <div className="space-y-3 p-4">
        <h2 className="text-base font-semibold">Take a photo</h2>
        <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-900">
          <video ref={video} autoPlay playsInline muted className={`h-full w-full object-cover ${shot ? 'hidden' : ''}`} style={{ transform: 'scaleX(-1)' }} aria-label="Live camera preview" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {shot && <img src={shot.url} alt="Captured photo" className="h-full w-full object-contain" />}
          {!shot && !ready && <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-300">Starting the camera… allow camera access if your browser asks.</p>}
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={() => { close(); cb.current.onFiles() }}>Choose from files instead</button>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={close}>Cancel</button>
            {!shot && <button type="button" className="btn-primary btn-sm" onClick={capture} disabled={!ready}>Capture</button>}
            {shot && <button type="button" className="btn-secondary btn-sm" onClick={() => { setShot(null); start() }}>Retake</button>}
            {shot && <button type="button" className="btn-primary btn-sm" onClick={() => { const f = shot.file; alive.current = false; dialog.current?.close(); cb.current.onPhoto(f) }}>Use photo</button>}
          </div>
        </div>
      </div>
    </dialog>
  )
}
