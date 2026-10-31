import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-slate-600">This page or record does not exist, or you do not have access to it.</p>
      <Link href="/" className="btn-primary mt-6">Go to dashboard</Link>
    </main>
  )
}
