import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { canSeeMasterData, listCountries, mdCan } from '@/server/services/master-data'
import { listCurrencies } from '@/server/services/payments'
import { CountryForm, StatusButton } from '../forms'

export const metadata: Metadata = { title: 'Countries' }

export default async function CountriesPage() {
  const ctx = await requireUser()
  if (!canSeeMasterData(ctx)) return <PageHeader title="Countries" description="You do not have access to master data." />
  const [rows, currencies] = await Promise.all([listCountries(ctx), listCurrencies(ctx, false)])
  const edit = mdCan(ctx, 'countries.manage'); const status = mdCan(ctx, 'masterdata.status')
  const cur = currencies.map((c) => ({ value: c.code, label: `${c.code} – ${c.name}` }))
  return (
    <>
      <PageHeader title="Country Management" description="Countries for destinations and previous education. Currency is indicative only; payments keep their own currency." />
      {edit && <Card title="Add a country" className="mb-5"><CountryForm c={null} currencies={cur} /></Card>}
      <div className="space-y-3">
        {rows.map((c) => (
          <Card key={c.id} title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-slate-500">{c.code}</span>{c.name}
            {!c.is_active && <Badge>Inactive</Badge>}{c.is_destination && <Badge tone="blue">Destination</Badge>}{c.is_education_origin && <Badge tone="purple">Education country</Badge>}</span>}
            actions={status && <StatusButton kind="country" id={c.id} active={c.is_active} label={c.name} />}>
            <p className="mb-3 text-sm text-slate-600">{c.universities} universit{c.universities === 1 ? 'y' : 'ies'} (<Link href={`/universities?country=${c.id}&inactive=yes`}>view</Link>) · {c.students} active students
              {c.nationality && ` · nationality ${c.nationality}`}{c.currency_code && ` · ${c.currency_code}`}{c.course_names.length > 0 && ` · courses: ${c.course_names.join(', ')}`}</p>
            {edit ? <CountryForm c={c} currencies={cur} /> : c.notes && <p className="text-sm">{c.notes}</p>}
          </Card>))}
      </div>
    </>
  )
}
