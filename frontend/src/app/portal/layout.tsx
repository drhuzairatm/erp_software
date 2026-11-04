import type { Metadata } from 'next'

export const metadata: Metadata = { title: { default: 'Student portal', template: '%s · Student portal' }, robots: { index: false, follow: false } }

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-slate-50">{children}</div>
}
