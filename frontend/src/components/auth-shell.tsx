import type { ReactNode } from 'react'
import { BrandMark } from '@/components/brand-mark'

/** Split-screen sign-in layout: brand panel (both companies, names as text unless official logos exist) + form card. */
export function AuthShell({ eyebrow, title, subtitle, children, footer }: { eyebrow: string; title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="bg-hero relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-32 h-[28rem] w-[28rem] rounded-full border border-cyan-brand/20" />
        <div aria-hidden className="pointer-events-none absolute -bottom-10 -right-10 h-72 w-72 rounded-full border border-white/10" />
        <BrandMark brand="all" />
        <div className="relative max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-brand">{eyebrow}</p>
          <p className="mt-3 text-4xl font-bold leading-tight tracking-tight">{title}</p>
          <p className="mt-3 text-slate-300">{subtitle}</p>
        </div>
        <p className="relative text-xs text-slate-400">Two companies · one secure system · company data kept separate</p>
      </section>
      <section className="flex items-center justify-center bg-[#f3f6fb] px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-6 rounded-2xl bg-navy-950 p-4 lg:hidden"><BrandMark brand="all" /><p className="mt-1 text-xs text-cyan-brand">{eyebrow}</p></div>
          <div className="card p-6 sm:p-7">{children}</div>
          {footer && <div className="mt-6 text-center text-xs text-slate-500">{footer}</div>}
        </div>
      </section>
    </main>
  )
}
