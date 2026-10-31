export const inr = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0)

export const kg = (n) => `${Number(n || 0).toFixed(3)} KG`

export const grams = (n) => `${Number(n || 0).toFixed(0)} g`

export const pct = (n) => `${Number(n || 0).toFixed(1)}%`

export const todayISO = () => new Date().toISOString().slice(0, 10)

export const monthISO = () => new Date().toISOString().slice(0, 7)

export function prettyDate(iso) {
  if (!iso) return '—'
  const parts = String(iso).slice(0, 10).split('-')
  if (parts.length < 3) return iso
  const [y, m, d] = parts
  return `${d}/${m}/${y}`
}

export function daysAgo(iso) {
  if (!iso) return 0
  const then = new Date(iso).getTime()
  const now = new Date(todayISO()).getTime()
  const diff = Math.floor((now - then) / (1000 * 60 * 60 * 24))
  return Math.max(0, diff)
}
