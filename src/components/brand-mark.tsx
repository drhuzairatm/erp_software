import { existsSync } from 'node:fs'
import path from 'node:path'
import { BRANDS, type BrandCode } from '@/lib/brands'

function officialLogo(code: 'edx' | 'grd') {
  for (const ext of ['svg', 'png']) {
    if (existsSync(path.join(process.cwd(), 'public', 'brands', `${code}-logo.${ext}`))) return `/brands/${code}-logo.${ext}`
  }
  return null
}

/** Company identity: the official logo when available, otherwise the company name as text. */
export function BrandMark({ brand, tone = 'dark' }: { brand: BrandCode; tone?: 'dark' | 'light' }) {
  const codes: ('edx' | 'grd')[] = brand === 'all' ? ['edx', 'grd'] : [brand]
  const text = tone === 'dark' ? 'text-white' : 'text-slate-900'
  return (
    <div className="flex flex-col gap-1">
      {codes.map((c) => {
        const logo = officialLogo(c)
        return logo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img key={c} src={logo} alt={BRANDS[c].name} className="h-10 w-auto max-w-[190px] rounded-md object-contain object-left" />
          : <span key={c} className={`text-[15px] font-bold leading-tight tracking-tight ${text} ${c === 'grd' ? 'uppercase tracking-[0.12em]' : ''}`}>{BRANDS[c].name}</span>
      })}
    </div>
  )
}
