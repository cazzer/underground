const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "FX" → "F◆": express variants are written as the base route plus a diamond, as on signage. */
export function routeChipLabel(shortName: string): string {
  const m = /^([0-9A-Z])X$/.exec(shortName)
  return m ? `${m[1]}◆` : shortName
}

/** "20261028-fall-2026-…" → "Schedule: Oct 28, 2026"; any other id is shown as is. */
export function scheduleLabel(feedVersion: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(feedVersion)
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined
  const day = m ? Number(m[3]) : 0
  if (!m || !month || day < 1 || day > 31) return `Schedule: ${feedVersion}`
  return `Schedule: ${month} ${day}, ${m[1]}`
}
