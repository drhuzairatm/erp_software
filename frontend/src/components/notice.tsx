import type { ReactNode } from 'react'

/** Visual alert levels used across the ERP. Every level has an icon AND a text label (never colour alone). */
export type Level = 'critical' | 'warning' | 'info' | 'success'

const ICONS: Record<Level, ReactNode> = {
  critical: <path d="M8.6 2h6.8L22 8.6v6.8L15.4 22H8.6L2 15.4V8.6L8.6 2zM12 7v6m0 3.5v.01" />,
  warning: <path d="M12 3 2 20h20L12 3zm0 6v5m0 3v.01" />,
  info: <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-11v6m0-9.5v.01" />,
  success: <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm-4.5-10 3 3 6-6" />,
}
export const LEVELS: Record<Level, { label: string; box: string; chip: string; icon: string; bar: string }> = {
  critical: { label: 'Critical', box: 'border-red-300 bg-red-50 text-red-950', chip: 'bg-red-600 text-white', icon: 'text-red-600', bar: 'bg-red-600' },
  warning: { label: 'Warning', box: 'border-amber-300 bg-amber-50 text-amber-950', chip: 'bg-amber-500 text-amber-950', icon: 'text-amber-600', bar: 'bg-amber-500' },
  info: { label: 'Information', box: 'border-blue-200 bg-blue-50 text-blue-950', chip: 'bg-blue-600 text-white', icon: 'text-blue-600', bar: 'bg-blue-600' },
  success: { label: 'Completed', box: 'border-green-200 bg-green-50 text-green-950', chip: 'bg-green-600 text-white', icon: 'text-green-600', bar: 'bg-green-600' },
}

export function LevelIcon({ level, className = 'h-5 w-5' }: { level: Level; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`${className} shrink-0 ${LEVELS[level].icon}`}>
      {ICONS[level]}
    </svg>
  )
}

export function LevelChip({ level, label }: { level: Level; label?: string }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${LEVELS[level].chip}`}>{label ?? LEVELS[level].label}</span>
}

/** Advisory notice display types → level and label */
export const DISPLAY: Record<string, { level: Level; label: string }> = {
  critical_alert: { level: 'critical', label: 'Critical alert' },
  mandatory_notice: { level: 'warning', label: 'Mandatory notice' },
  important_warning: { level: 'warning', label: 'Important warning' },
  additional_point: { level: 'info', label: 'Additional point' },
  general_information: { level: 'info', label: 'Information' },
}

/**
 * A coloured notice card. `compact` renders a single line with expandable details (for normal / informational priority);
 * critical and high priority notices are shown expanded.
 */
export function NoticeCard({ level, label, title, children, details, actions, compact, footer }: {
  level: Level; label?: string; title: ReactNode; children?: ReactNode; details?: ReactNode; actions?: ReactNode; compact?: boolean; footer?: ReactNode
}) {
  const s = LEVELS[level]
  if (compact) {
    return (
      <details className={`group rounded-lg border ${s.box}`}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
          <LevelIcon level={level} className="h-4 w-4" /><LevelChip level={level} label={label} /><span className="font-medium">{title}</span>
          <span aria-hidden className="ml-auto text-xs opacity-60 group-open:rotate-180">▾</span>
        </summary>
        <div className="space-y-2 px-3 pb-3 text-sm">{children}{details}{actions && <div className="flex flex-wrap gap-2">{actions}</div>}{footer}</div>
      </details>
    )
  }
  return (
    <section role={level === 'critical' ? 'alert' : undefined} className={`relative overflow-hidden rounded-lg border pl-4 ${s.box}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${s.bar}`} />
      <div className="flex flex-wrap items-start gap-3 px-3 py-3">
        <LevelIcon level={level} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2"><LevelChip level={level} label={label} /><h3 className="text-sm font-semibold">{title}</h3></div>
          {children && <div className="text-sm">{children}</div>}
          {details && <details className="text-sm"><summary className="cursor-pointer text-xs font-medium opacity-80">Details</summary><div className="mt-1">{details}</div></details>}
          {footer && <div className="text-xs">{footer}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </section>
  )
}
