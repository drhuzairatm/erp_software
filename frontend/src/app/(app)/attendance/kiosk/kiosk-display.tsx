'use client'

import { useCallback, useEffect, useState } from 'react'
import { issueKioskQrAction } from '@/app/actions/attendance'

export function KioskDisplay({ offices }: { offices: { id: string; label: string }[] }) {
  const [office, setOffice] = useState(offices[0]?.id ?? '')
  const [qr, setQr] = useState<{ dataUrl: string; expiresAt: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!office) return
    try { setQr(await issueKioskQrAction(office)); setErr(null) } catch { setQr(null); setErr('A new code could not be created. Check the connection; this screen keeps trying.') }
  }, [office])
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0)
    const t = setInterval(() => void refresh(), 30000)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [refresh])
  if (!offices.length) return <p className="text-sm text-slate-600">Add an office in Attendance settings first.</p>
  return (
    <div className="card max-w-md p-6 text-center">
      <label className="label text-left" htmlFor="k-office">Office</label>
      <select id="k-office" className="input mb-4" value={office} onChange={(e) => setOffice(e.target.value)}>{offices.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr && <img src={qr.dataUrl} alt="Office attendance QR code" data-testid="kiosk-qr" className="mx-auto h-72 w-72" />}
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <p className="hint mt-2">The code renews by itself.</p>
    </div>
  )
}
