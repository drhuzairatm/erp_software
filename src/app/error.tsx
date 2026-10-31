'use client'

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // The error details are logged on the server; nothing internal is shown here.
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">The problem has been logged. Please try again. If it keeps happening, contact your administrator.</p>
      <button className="btn-primary mt-6" onClick={() => reset()}>Try again</button>
    </main>
  )
}
