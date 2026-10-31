import type { Metadata } from 'next'
import Link from 'next/link'
import { VerifyCodeForm } from '../forms'

export const metadata: Metadata = { title: 'Enter your code' }

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <div className="card space-y-4 p-6">
        <h1 className="text-xl font-semibold">Enter your code</h1>
        <p className="text-sm text-slate-600">If we found your details, we sent a 6-digit code to your email or WhatsApp. It expires in 10 minutes.</p>
        {c ? <VerifyCodeForm challenge={c} /> : <p className="text-sm">Please <Link href="/portal">request a code</Link> first.</p>}
        <p className="text-center text-sm"><Link href="/portal">Didn&apos;t get it? Request a new code</Link></p>
      </div>
    </main>
  )
}
