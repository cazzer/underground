import { str, trimFeatures, type RowReader, type SourceResults } from './geocodeCandidate'
import { cleanLabel } from './geocodeText'
import type { GeocodeKind } from './schema'

/** Stops, stations and entrances: the station search covers them, and they flood "Barclays Center". */
const TRANSIT_KEYS = new Set(['railway', 'public_transport'])
/** Bus stops are tagged highway=bus_stop; other highway rows (streets, paths) are wanted. */
const isBusStop = (p: Record<string, unknown>): boolean => p.osm_key === 'highway' && p.osm_value === 'bus_stop'
const AREA_TYPES = new Set(['locality', 'district', 'city', 'county'])
/** The NYC bbox also covers Jersey City, Hoboken and Newark. */
const STATE = 'New York'
const COUNTRY = 'US'

function kindOf(p: Record<string, unknown>, named: boolean): GeocodeKind {
  const type = str(p.type)
  if (type === 'street') return 'street'
  if (type !== null && AREA_TYPES.has(type)) return 'area'
  if (!named) return 'address'
  return p.osm_key === 'place' && p.osm_value === 'house' ? 'address' : 'place'
}

const readRow: RowReader = (p) => {
  if (p.state !== undefined && p.state !== STATE) return null
  if (p.countrycode !== undefined && p.countrycode !== COUNTRY) return null
  if (typeof p.osm_key === 'string' && TRANSIT_KEYS.has(p.osm_key)) return null
  if (isBusStop(p)) return null
  if (p.type === 'country' || p.type === 'state') return null

  const housenumber = str(p.housenumber)
  const street = str(p.street)
  const address = housenumber !== null && street !== null ? `${housenumber} ${street}` : null
  const given = cleanLabel(str(p.name) ?? '')
  // An unnamed row is an address, and needs both parts.
  const name = given ?? (p.type === 'street' ? null : address)
  if (name === null) return null
  const parts = [name]
  if (given !== null && address !== null && p.type !== 'street') parts.push(address)
  const area = str(p.district) ?? str(p.city)
  if (area !== null) parts.push(area)
  const label = cleanLabel(parts.join(', '))
  if (label === null) return null
  return { name: cleanLabel(name) ?? name, label, kind: kindOf(p, given !== null), address: given !== null ? address : null }
}

/** Photon answer to candidates; throws a fixed-message TypeError on a bad shape. */
export function trimPhoton(json: unknown): SourceResults {
  return trimFeatures(json, 'photon', readRow)
}
