import type { Metadata } from 'next'
import { Alert, Card, PageHeader } from '@/components/ui'
import { can } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { listCurrencies } from '@/server/services/payments'
import { CurrencyForm } from './forms'

export const metadata: Metadata = { title: 'Currencies & reference rates' }

export default async function CurrenciesPage() {
  const ctx = await requireUser()
  if (!can(ctx, 'currencies.manage')) return <PageHeader title="Currencies & reference rates" description="You do not have access to this page." />
  const list = await listCurrencies(ctx, false)
  return (
    <>
      <PageHeader title="Currencies & reference rates" description="Currencies available for payments, and an optional reference rate that only pre-fills the payment form." />
      <div className="mb-4"><Alert tone="blue">Every payment stores the exchange rate actually applied by the accounts team. Changing a reference rate here never changes
        any recorded payment, and the applied rate is always the one entered on the payment.</Alert></div>
      <div className="space-y-4">
        {list.map((c) => <Card key={c.code} title={`${c.code} – ${c.name}`}><CurrencyForm c={c} /></Card>)}
        <Card title="Add a currency"><CurrencyForm c={null} /></Card>
      </div>
    </>
  )
}
