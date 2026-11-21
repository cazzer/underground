/** Pure trimming of the vkng-7ivg station envelope GeoJSON (2D polygons around each station's public
 *  areas). Only NYCT stations are kept. The source has hundreds of vertices per arc, so each ring is
 *  simplified (Douglas-Peucker in meters) and rounded to 6 decimals (about 0.1 m). */
import { toGround } from '../../src/lib/projection.ts'
import { list, pair, record, text } from './check.ts'
import type { CatalogEnvelope } from './catalogTypes.ts'
import { simplifyIndices } from './simplify.ts'

function optText(v: unknown, path: string): string | null {
  return v === undefined || v === null ? null : text(v, path)
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

/** One GeoJSON ring ([lon, lat] pairs) to a simplified, closed ring of [lat, lon]. */
function simplifyRing(raw: unknown, toleranceM: number, at: string): [number, number][] {
  const ring = list(raw, at).map((p, i) => {
    const [lon, lat] = pair(p, `${at}[${i}]`)
    return { lat, lon }
  })
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (ring.length < 4 || !first || !last || first.lat !== last.lat || first.lon !== last.lon) {
    throw new Error(`${at}: expected a closed ring (first point equal to last, at least 4 points), got ${ring.length} points`)
  }
  const kept = simplifyIndices(ring.map((p) => toGround(p)), toleranceM)
  const used = kept.length >= 4 ? kept.map((i) => ring[i]!) : ring
  return used.map((p): [number, number] => [round6(p.lat), round6(p.lon)])
}

/** The NYCT (including NYCT/PATH) features, sorted by numeric shape_id. Anything but a Polygon throws. */
export function trimEnvelopes(geojson: unknown, toleranceM = 0.5): CatalogEnvelope[] {
  const root = record(geojson, 'envelopes')
  return list(root.features, 'envelopes.features')
    .map((f, i) => ({ feature: record(f, `envelopes.features[${i}]`), at: `envelopes.features[${i}]` }))
    .filter(({ feature, at }) => text(record(feature.properties, `${at}.properties`).agency, `${at}.properties.agency`).includes('NYCT'))
    .map(({ feature, at }): CatalogEnvelope => {
      const props = record(feature.properties, `${at}.properties`)
      const geometry = record(feature.geometry, `${at}.geometry`)
      if (geometry.type !== 'Polygon') throw new Error(`${at}.geometry.type: expected Polygon, got ${JSON.stringify(geometry.type)}`)
      const shapeId = text(props.shape_id, `${at}.properties.shape_id`)
      if (!/^\d+$/.test(shapeId)) throw new Error(`${at}.properties.shape_id: expected digits, got ${JSON.stringify(shapeId)}`)
      return {
        shapeId,
        name: text(props.station_name, `${at}.properties.station_name`),
        division: optText(props.division, `${at}.properties.division`),
        borough: optText(props.borough, `${at}.properties.borough`),
        agency: text(props.agency, `${at}.properties.agency`),
        rings: list(geometry.coordinates, `${at}.geometry.coordinates`).map((ring, r) => simplifyRing(ring, toleranceM, `${at}.geometry.coordinates[${r}]`)),
      }
    })
    .sort((a, b) => Number(a.shapeId) - Number(b.shapeId))
}
