/**
 * Lightweight, dependency-free SVG charts (responsive via viewBox). Every chart has a text alternative
 * (aria-label + visually hidden list) so values are available without colour or graphics.
 */
import type { ReactNode } from 'react'

export const PALETTE = ['#36D9FF', '#24E0B8', '#6C8CFF', '#FFB547', '#FF6B8B', '#A78BFA', '#4ADE80', '#F472B6', '#22D3EE', '#FB923C', '#94A3B8']

const fmt = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e3)}k` : String(Math.round(n * 10) / 10))

function SrList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <ul className="sr-only">{items.map((i) => <li key={i.label}>{i.label}: {i.value}</li>)}</ul>
}

export function Sparkline({ values, color = '#36D9FF', width = 96, height = 32 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1); const min = Math.min(...values, 0)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 2 - ((v - min) / (max - min || 1)) * (height - 4)])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const id = `sg${color.replace('#', '')}`
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden className="overflow-visible">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.35" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function BarChart({ data, color = '#36D9FF', height = 220, title, valueSuffix = '', width = 640 }: { data: { label: string; value: number }[]; color?: string; height?: number; title: string; valueSuffix?: string; width?: number }) {
  const W = width; const H = height; const pad = { l: 34, r: 8, t: 14, b: 28 }
  const max = Math.max(...data.map((d) => d.value), 1)
  const nice = Math.ceil(max / 4) * 4 || 4
  const bw = Math.min((W - pad.l - pad.r) / Math.max(data.length, 1), 90)
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
        <defs><linearGradient id={`barg${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} /><stop offset="100%" stopColor={color} stopOpacity="0.55" /></linearGradient></defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = pad.t + (H - pad.t - pad.b) * (1 - f)
          return <g key={f}><line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray={f ? '3 4' : undefined} />
            <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{fmt(nice * f)}</text></g>
        })}
        {data.map((d, i) => {
          const h = ((H - pad.t - pad.b) * d.value) / nice
          const x = pad.l + i * bw + bw * 0.18
          return (
            <g key={d.label}>
              <rect x={x} y={H - pad.b - h} width={bw * 0.64} height={Math.max(h, d.value ? 2 : 0)} rx={5} fill={`url(#barg${color.slice(1)})`}><title>{`${d.label}: ${d.value}${valueSuffix}`}</title></rect>
              {d.value > 0 && <text x={x + bw * 0.32} y={H - pad.b - h - 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="#334155">{fmt(d.value)}</text>}
              <text x={x + bw * 0.32} y={H - 10} textAnchor="middle" fontSize="10" fill="#64748b">{d.label}</text>
            </g>
          )
        })}
      </svg>
      <SrList items={data.map((d) => ({ label: d.label, value: `${d.value}${valueSuffix}` }))} />
    </figure>
  )
}

export function HBarList({ data, title, max: maxIn }: { data: { label: string; value: number; color?: string; sub?: string }[]; title: string; max?: number }) {
  const max = maxIn ?? Math.max(...data.map((d) => d.value), 1)
  return (
    <ul className="space-y-2.5" aria-label={title}>
      {data.map((d, i) => (
        <li key={d.label}>
          <div className="mb-1 flex justify-between gap-2 text-sm"><span className="truncate text-slate-700">{d.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{d.value}{d.sub && <span className="ml-1 text-xs font-normal text-slate-500">{d.sub}</span>}</span></div>
          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? PALETTE[i % PALETTE.length] }} /></div>
        </li>
      ))}
    </ul>
  )
}

export function DonutChart({ data, title, centerLabel, size = 180 }: { data: { label: string; value: number; color?: string }[]; title: string; centerLabel?: string; size?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0)
  const r = 70; const c = 2 * Math.PI * r
  let acc = 0
  const shown = data.filter((d) => d.value > 0)
  return (
    <figure className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={`${title}: ${shown.map((d) => `${d.label} ${d.value}`).join(', ')}`} className="shrink-0">
        <circle cx="100" cy="100" r={r} fill="none" stroke="#eef2f7" strokeWidth="26" />
        {total > 0 && shown.map((d, i) => {
          const len = (d.value / total) * c
          const el = <circle key={d.label} cx="100" cy="100" r={r} fill="none" stroke={d.color ?? PALETTE[data.indexOf(d) % PALETTE.length]} strokeWidth="26"
            strokeDasharray={`${Math.max(len - 2, 0.5)} ${c - Math.max(len - 2, 0.5)}`} strokeDashoffset={-acc} transform="rotate(-90 100 100)"><title>{`${d.label}: ${d.value}`}</title></circle>
          acc += len
          void i
          return el
        })}
        <text x="100" y="96" textAnchor="middle" fontSize="30" fontWeight="700" fill="#0f172a">{total}</text>
        <text x="100" y="118" textAnchor="middle" fontSize="11" fill="#64748b">{centerLabel ?? 'Total'}</text>
      </svg>
      <ul className="grid w-full grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color ?? PALETTE[i % PALETTE.length] }} />
            <span className="flex-1 truncate text-slate-700">{d.label}</span>
            <span className="font-semibold tabular-nums">{d.value}</span>
            <span className="w-10 text-right text-xs tabular-nums text-slate-500">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function LineChart({ labels, series, title, height = 220 }: { labels: string[]; series: { label: string; values: number[]; color?: string }[]; title: string; height?: number }) {
  const W = 640; const H = height; const pad = { l: 44, r: 10, t: 14, b: 28 }
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const x = (i: number) => pad.l + (i / Math.max(labels.length - 1, 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#e2e8f0" strokeDasharray={f ? '3 4' : undefined} />
          <text x={pad.l - 6} y={y(max * f) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{fmt(max * f)}</text></g>)}
        {series.map((s, si) => {
          const col = s.color ?? PALETTE[si]
          const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
          return <g key={s.label}><path d={d} fill="none" stroke={col} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="#fff" stroke={col} strokeWidth={2}><title>{`${s.label} – ${labels[i]}: ${v}`}</title></circle>)}</g>
        })}
        {labels.map((l, i) => <text key={l + i} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="#64748b">{l}</text>)}
      </svg>
      {series.length > 1 && <div className="mt-1 flex flex-wrap gap-3 text-xs">{series.map((s, i) => <span key={s.label} className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-4 rounded" style={{ background: s.color ?? PALETTE[i] }} />{s.label}</span>)}</div>}
      <SrList items={series.flatMap((s) => s.values.map((v, i) => ({ label: `${s.label} ${labels[i]}`, value: v })))} />
    </figure>
  )
}

export function RadialProgress({ value, label, sub, color = '#36D9FF', size = 112 }: { value: number; label: string; sub?: string; color?: string; size?: number }) {
  const v = Math.max(0, Math.min(100, value)); const r = 44; const c = 2 * Math.PI * r
  return (
    <figure className="flex flex-col items-center text-center">
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${label}: ${Math.round(v)}%`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#eef2f7" strokeWidth="9" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
        <text x="50" y="55" textAnchor="middle" fontSize="20" fontWeight="700" fill="#0f172a">{Math.round(v)}%</text>
      </svg>
      <figcaption className="mt-1 text-sm font-medium text-slate-700">{label}</figcaption>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </figure>
  )
}
