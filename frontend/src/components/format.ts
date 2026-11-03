const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })

/** Format a 'YYYY-MM-DD' string or Date. */
export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—'
  if (typeof d === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { const t = new Date(d); return Number.isNaN(t.getTime()) ? '—' : dateFmt.format(t) }
    const [y, m, day] = d.split('-').map(Number)
    return dateFmt.format(new Date(Date.UTC(y, m - 1, day, 6)))
  }
  return dateFmt.format(d)
}

export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return '—'
  return dateTimeFmt.format(typeof d === 'string' ? new Date(d) : d)
}

export function fmtMoney(amount: string | number | null | undefined, currency = 'INR') {
  if (amount == null) return '—'
  const n = typeof amount === 'string' ? Number(amount) : amount
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
}

export function label(s: string | null | undefined) {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}

/** ISO date `days` from today (India time). */
export function daysFromTodayISO(days: number) {
  const [y, m, d] = todayISO().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
