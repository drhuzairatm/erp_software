'use client'

import { useEffect, useRef, useState } from 'react'


export const PHOTO_HELP = 'Upload a recent passport-size photograph with a plain white background, face centred and clearly visible. JPG or PNG, maximum 5 MB.'

/**
 * Passport photo picker: camera or gallery, preview, drag to reposition, zoom. Submits the chosen file
 * (`name`) and the crop rectangle in image pixels (`${name}Crop`). The server re-checks and processes everything.
 */
export function PhotoPicker({ name = 'photo', onChange, square = false, help = PHOTO_HELP }: { name?: string; onChange?: (chosen: boolean) => void; square?: boolean; help?: string }) {
  const FRAME_W = square ? 220 : 210
  const FRAME_H = square ? 220 : Math.round(210 / (35 / 45))
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const base = nat ? Math.max(FRAME_W / nat.w, FRAME_H / nat.h) : 1
  const scale = base * zoom
  const clamp = (o: { x: number; y: number }, s = scale) => nat ? ({
    x: Math.min(0, Math.max(FRAME_W - nat.w * s, o.x)), y: Math.min(0, Math.max(FRAME_H - nat.h * s, o.y)),
  }) : o
  const crop = nat ? { x: -off.x / scale, y: -off.y / scale, width: FRAME_W / scale, height: FRAME_H / scale } : null

  const pick = (input: HTMLInputElement, other: HTMLInputElement | null) => {
    const f = input.files?.[0]
    setError(null)
    if (other) other.value = ''
    if (!f) return
    if (!['image/jpeg', 'image/png'].includes(f.type)) { setError('Please choose a JPG or PNG photo.'); input.value = ''; return }
    if (f.size > 5 * 1024 * 1024) { setError('The photo is larger than 5 MB.'); input.value = ''; return }
    setNat(null); setZoom(1)
    setUrl(URL.createObjectURL(f))
    onChange?.(true)
  }
  const cancel = () => {
    if (camRef.current) camRef.current.value = ''
    if (galRef.current) galRef.current.value = ''
    setUrl(null); setNat(null); setError(null); onChange?.(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="btn-secondary btn-sm cursor-pointer">
          <input ref={camRef} type="file" name={name} accept="image/jpeg,image/png" capture="user" className="sr-only"
            onChange={(e) => pick(e.currentTarget, galRef.current)} />Take photo
        </label>
        <label className="btn-secondary btn-sm cursor-pointer">
          <input ref={galRef} type="file" name={name} accept="image/jpeg,image/png" className="sr-only"
            onChange={(e) => pick(e.currentTarget, camRef.current)} aria-label="Choose a photo from the device" />Choose from gallery / files
        </label>
        {url && <button type="button" className="btn-ghost btn-sm" onClick={cancel}>Cancel / choose another</button>}
      </div>
      <p className="hint">{help}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {url && (
        <div className="flex flex-wrap items-start gap-5">
          <div>
            <div className="relative touch-none select-none overflow-hidden rounded-lg bg-slate-200 ring-2 ring-brand-500"
              style={{ width: FRAME_W, height: FRAME_H, cursor: 'grab' }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y } }}
              onPointerMove={(e) => { const d = drag.current; if (d) setOff(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })) }}
              onPointerUp={() => { drag.current = null }} aria-label="Drag to reposition the photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Selected photo" draggable={false} className="absolute left-0 top-0 max-w-none"
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
                  // keep the centre of the frame fixed while zooming
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
                <img src={url} alt="" aria-hidden className="max-w-none" style={{
                  width: nat.w * (64 / crop.width), height: nat.h * (64 / crop.width),
                  transform: `translate(${-crop.x * (64 / crop.width)}px, ${-(crop.y + (square ? 0 : crop.height * 0.08)) * (64 / crop.width)}px)` }} />
              )}
            </div>
            <p className="mt-1">Avatar preview</p>
          </div>
        </div>
      )}
      {crop && <input type="hidden" name={`${name}Crop`} value={JSON.stringify({ x: Math.round(crop.x), y: Math.round(crop.y), width: Math.round(crop.width), height: Math.round(crop.height) })} />}
    </div>
  )
}
