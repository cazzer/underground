import type { Borough } from '../data/schema'
import type { StationAccessInfo } from './network'

const MONTHS =['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "FX" → "F◆": express variants are written as the base route plus a diamond, as on signage. */
export function routeChipLabel(shortName: string): string {
  const m = /^([0-9A-Z])X$/.exec(shortName)
  return m ? `${m[1]}◆` : shortName
}

/** "FX" → "F express": what a screen reader should say where the chip shows a diamond. */
export function routeSpokenName(shortName: string): string {
  const m = /^([0-9A-Z])X$/.exec(shortName)
  return m ? `${m[1]} express` : shortName
}

/** "20261028-fall-2026-…" → "Schedule: Oct 28, 2026"; any other id is shown as is. */
export function scheduleLabel(feedVersion: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(feedVersion)
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined
  const day = m ? Number(m[3]) : 0
  if (!m || !month || day < 1 || day > 31) return `Schedule: ${feedVersion}`
  return `Schedule: ${month} ${day}, ${m[1]}`
}

const BOROUGHS: Record<Borough, string> = { Bx: 'Bronx', M: 'Manhattan', Bk: 'Brooklyn', Q: 'Queens', SI: 'Staten Island' }

/** "Bk" → "Brooklyn". */
export function boroughName(code: Borough): string {
  return BOROUGHS[code]
}

/** What the access icon says: null for a station that isn't accessible (no marker is drawn for those). */
export function accessLabel(access: StationAccessInfo): string | null {
  if (access.status === 'full') return 'Accessible station'
  if (access.status === 'partial') return access.note ? `Partly accessible: ${access.note}` : 'Partly accessible'
  return null
}

/** Names used by more than one station; search rows show the borough under these. */
export function sharedNames(stations: readonly { name: string }[]): Set<string> {
  const seen = new Set<string>()
  const shared = new Set<string>()
  for (const { name } of stations) {
    if (seen.has(name)) shared.add(name)
    else seen.add(name)
  }
  return shared
}
