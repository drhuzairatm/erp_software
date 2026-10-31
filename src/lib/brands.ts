/**
 * Company identities. The two companies are never merged: each has its own name and description.
 * Official logo files are NOT in the project; a logo is shown only if the official file is placed at
 * public/brands/<code>-logo.(svg|png). Otherwise the company name is shown as text (no invented logos).
 */
export type BrandCode = 'edx' | 'grd' | 'all'
export const BRANDS: Record<BrandCode, { name: string; short: string; tagline: string }> = {
  edx: { name: 'Dr.Expert Edulinks', short: 'Edulinks', tagline: 'MBBS · Nursing · Postgraduate Medical admissions' },
  grd: { name: 'GRADUATER', short: 'GRADUATER', tagline: 'International education consultancy' },
  all: { name: 'Dr.Expert Edulinks & GRADUATER', short: 'Group view', tagline: 'Consolidated view across both companies' },
}
export function brandOf(orgCode: string | null | undefined): BrandCode {
  return orgCode === 'GRD' ? 'grd' : orgCode === 'EDX' ? 'edx' : 'all'
}
