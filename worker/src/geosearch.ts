import { str, trimFeatures, type RowReader, type SourceResults } from './geocodeCandidate'
import { cleanLabel } from './geocodeText'
import type { GeocodeKind } from './schema'

const AREA_LAYERS = new Set(['neighbourhood', 'borough', 'locality', 'postalcode', 'county', 'region', 'macrohood'])

function kindOf(layer: string | null, housenumber: string | null): GeocodeKind {
  if (layer === 'street') return 'street'
  if (layer !== null && AREA_LAYERS.has(layer)) return 'area'
  // GeoSearch answers every PAD hit as layer "venue"; only an address has a house number.
  return housenumber !== null ? 'address' : 'place'
}

const readRow: RowReader = (p) => {
  const name = cleanLabel(str(p.name) ?? '')
  if (name === null) return null
  const borough = str(p.borough)
  const label = cleanLabel(borough === null ? name : `${name}, ${borough}`)
  if (label === null) return null
  return { name, label, kind: kindOf(str(p.layer), str(p.housenumber)) }
}

/** NYC GeoSearch (Pelias) autocomplete answer to candidates; throws a fixed-message TypeError on a bad shape. */
export function trimGeoSearch(json: unknown): SourceResults {
  return trimFeatures(json, 'geosearch', readRow)
}
