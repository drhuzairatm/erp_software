import { AuthShell } from '@/components/auth-shell'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthShell eyebrow="Staff portal" title="Admissions, documents and students — in one place." subtitle="Dr.Expert Edulinks and GRADUATER staff sign in here."
      footer="Authorized staff only. Activity is logged.">
      {children}
    </AuthShell>
  )
}
