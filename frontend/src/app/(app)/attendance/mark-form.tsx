'use client'

import { useEffect, useRef, useState } from 'react'
import { markAttendanceAction } from '@/app/actions/attendance'
import { ActionForm, SubmitButton } from '@/components/forms'
import { cameraErrorMessage } from '@/components/photo-capture'

/**
 * What the device reports. None of it is trusted alone: the server keeps the time, and a missing or failed signal sends the record to manual review.
 * The photo is a live capture from the camera, with no gallery option.
 */
export function MarkAttendance({ orgs, actions, qr }: { orgs: { id: string; name: string }[]; actions: { key: string; label: string; primary?: boolean; photo?: boolean }[]; qr?: string }) {
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  const [gpsMsg, setGpsMsg] = useState('Asking for your location…')
  const [camera, setCamera] = useState<'off' | 'on' | 'taken'>('off')
  const [videoReady, setVideoReady] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const locate = () => {
    if (!navigator.geolocation) { setGpsMsg('This browser cannot share a location. Your attendance will go to manual review.'); return }
    setGpsMsg('Asking for your location…')
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); setGpsMsg(`Location shared (about ${Math.round(p.coords.accuracy)} m accuracy).`) },
      () => { setPos(null); setGpsMsg('Location not shared. You can still mark attendance; it will go to manual review.') },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }
  useEffect(() => {
    const first = setTimeout(locate, 0)
    return () => { clearTimeout(first); stream.current?.getTracks().forEach((t) => t.stop()) }
  }, [])

  const startCamera = async () => {
    setCamError(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      stream.current = s
      setVideoReady(false)
      setCamera('on')
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; video.current.play().catch(() => { /* replaced by a new capture or the page closed */ }) } })
    } catch (e) { setCamError(`${cameraErrorMessage(e)} You can still mark attendance; it will go to manual review.`) }
  }
  const capture = () => {
    const v = video.current
    if (!v || !v.videoWidth) return // no picture yet: never store a blank photo
    const c = document.createElement('canvas'); c.width = Math.min(v.videoWidth || 640, 640); c.height = Math.round(c.width * ((v.videoHeight || 480) / (v.videoWidth || 640)))
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height)
    c.toBlob((blob) => {
      if (!blob || !fileInput.current) return
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'attendance.jpg', { type: 'image/jpeg' }))
      fileInput.current.files = dt.files
      setPreview(c.toDataURL('image/jpeg', 0.7)); setCamera('taken')
      stream.current?.getTracks().forEach((t) => t.stop())
    }, 'image/jpeg', 0.85)
  }

  return (
    <ActionForm action={markAttendanceAction} className="space-y-4">
      {orgs.length > 1 ? <div><label className="label" htmlFor="att-org">Company</label><select id="att-org" name="orgId" className="input">{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        : <input type="hidden" name="orgId" value={orgs[0]?.id ?? ''} />}
      <input type="hidden" name="lat" value={pos?.lat ?? ''} /><input type="hidden" name="lng" value={pos?.lng ?? ''} /><input type="hidden" name="accuracy" value={pos?.accuracy ?? ''} />
      <input type="hidden" name="qr" value={qr ?? ''} />
      <input type="hidden" name="device" value={typeof navigator === 'undefined' ? '' : navigator.userAgent} />
      <input ref={fileInput} type="file" name="photo" accept="image/jpeg" className="hidden" tabIndex={-1} aria-hidden />
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="att-method">How you are marking</label>
          <select id="att-method" name="method" className="input"><option value="mobile">My phone or laptop</option><option value="kiosk">Office tablet (kiosk)</option></select></div>
        <div className="text-sm"><p className="label">Location</p><p role="status" className="text-slate-600">{gpsMsg}</p>
          {!pos && <button type="button" className="btn-ghost btn-sm mt-1" onClick={locate}>Try again</button>}</div>
      </div>
      {qr && <p className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">Office QR scanned. It will be checked when you submit.</p>}
      <div className="text-sm">
        <p className="label">Camera photo</p>
        {camera === 'off' && <button type="button" className="btn-secondary btn-sm" onClick={startCamera}>Turn on camera</button>}
        {camera === 'on' && <div className="space-y-2">
          <video ref={video} muted playsInline onPlaying={() => setVideoReady(true)} className="w-full max-w-xs rounded-lg bg-slate-900" />
          <button type="button" className="btn-primary btn-sm" disabled={!videoReady} onClick={capture}>Take photo</button></div>}
        {camera === 'taken' && preview && <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Your attendance capture" className="h-20 w-20 rounded-lg object-cover" />
          <button type="button" className="btn-ghost btn-sm" onClick={() => { setPreview(null); if (fileInput.current) fileInput.current.value = ''; void startCamera() }}>Retake</button></div>}
        {camError && <p role="alert" className="mt-1 text-amber-800">{camError}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => <SubmitButton key={a.key} name="action" value={a.key} className={a.primary ? 'btn-primary' : 'btn-secondary'} pendingText="Saving…">{a.label}</SubmitButton>)}
      </div>
      <p className="hint">The time is taken from the server. Location, network, QR and photo help confirm your attendance; if one is missing, a manager reviews it. No face recognition is used.</p>
    </ActionForm>
  )
}
