export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-sm font-medium uppercase tracking-wider text-brand-700">Staff Portal</p>
          <p className="mt-1 text-lg font-semibold">Dr.Expert Edulinks · GRADUATER</p>
        </div>
        <div className="card p-6">{children}</div>
        <p className="mt-6 text-center text-xs text-slate-500">Authorized staff only. Activity is logged.</p>
      </div>
    </main>
  )
}
