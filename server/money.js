export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function monthKey(dateStr) {
  return String(dateStr).slice(0, 7)
}

export function inRange(dateStr, from, to) {
  if (from && dateStr < from) return false
  if (to && dateStr > to) return false
  return true
}
