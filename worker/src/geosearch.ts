import { str, trimFeatures, type RowReader, type SourceResults } from './geocodeCandidate'
import { cleanLabel } from './geocodeText'
import type { GeocodeKind } from './schema'

const AREA_LAYERS = new Set(['neighbourhood', 'borough', 'locality', 'postalcode', 'county', 'region', 'macrohood'])

function kindOf(layer: string | null, housenumber: string | null): GeocodeKind {
  if (layer !== null && AREA_LAYERS.has(layer)) return 'area'
  // GeoSearch answers every PAD hit as layer "venue"; only an address has a house number.
  return housenumber !== null ? 'address' : 'place'
}

const readRow: RowReader = (p) => {
  // Streets come from the Worker's own index (2q7.14): the upstream's would double them with another label.
  if (str(p.layer) === 'street') return null
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
