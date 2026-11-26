import type { Borough } from '../data/schema'
import type { AmenityKind } from './amenityGlyphs'
import type { StationAccessInfo } from './network'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

const AMENITY_WORDS: Record<AmenityKind, string> = {
  restroom: 'restroom listed by the MTA',
  csc: 'customer service center, staffed 24/7',
}

/**
 * What a station's amenity glyphs say, as one sentence without its full stop: "Restroom listed by the MTA; customer
 * service center, staffed 24/7, enter at 42 St and Park Av". Null with none. The restroom is only what the MTA lists:
 * never its count, hours, access or whether it is open. The entrance is the MTA page's own "Enter at …" text.
 */
export function amenityLabel(kinds: readonly AmenityKind[], cscEntrance: string | null = null): string | null {
  if (kinds.length === 0) return null
  const parts = kinds.map((kind) => {
    const words = AMENITY_WORDS[kind]
    if (kind !== 'csc' || cscEntrance === null) return words
    return `${words}, ${cscEntrance.charAt(0).toLowerCase()}${cscEntrance.slice(1)}`
  })
  const sentence = parts.join('; ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/**
 * The hidden text after a station's name in its heading and bar: ", <access>." then " <amenities>." (". <amenities>."
 * with no access label), so the name, its access and its amenities read as fixed sentences. Empty with neither.
 */
export function spokenAfterName(access: string | null, noStepFreeNow: boolean, amenities: string | null): string {
  const accessSaid = access === null ? '' : `, ${access}${noStepFreeNow ? '; no step-free access now' : ''}.`
  const amenitiesSaid = amenities === null ? '' : `${access === null ? '.' : ''} ${amenities}.`
  return accessSaid + amenitiesSaid
}

/**
 * Names whose stations lie in more than one borough; search rows show the borough under these. A name shared
 * within one borough (every "145 St" is in Manhattan) gets none: the borough wouldn't tell them apart.
 */
export function multiBoroughNames(stations: readonly { name: string; borough?: Borough }[]): Set<string> {
  const boroughs = new Map<string, Set<Borough>>()
  for (const { name, borough } of stations) {
    if (borough === undefined) continue
    const seen = boroughs.get(name) ?? new Set<Borough>()
    seen.add(borough)
    boroughs.set(name, seen)
  }
  return new Set([...boroughs].filter(([, seen]) => seen.size > 1).map(([name]) => name))
}

const UPDATED_FORMAT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })

/** "updated 2:41 PM" in New York time (the feed's), for data that may be out of date. */
export function updatedLabel(epochS: number): string {
  return `updated ${UPDATED_FORMAT.format(new Date(epochS * 1000))}`
}
