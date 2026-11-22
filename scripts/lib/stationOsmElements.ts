/** Pinning OSM lines (open or closed ways, such as stairs) and nodes (such as a street elevator) for an authored
 *  station: the Overpass query and the trim of its response. Everything fetched is untrusted: each field is checked
 *  here and failures name the element. Platform rings (`trimOverpassWays`) stay in stationSources.ts. */
import { finite, list, record, text } from './check.ts'
import type { AuthoredStation, OsmLine, OsmNode } from './stationInputs.ts'

/** Kept on lines and nodes. A separate list from the platform ways', so a station without lines pins what it did. */
const KEPT_ELEMENT_TAGS = ['level', 'highway', 'incline', 'step_count']

const HEADER = '[out:json][timeout:60];'

/** Ids go into the query text, so each must be a positive safe integer (a hand-edited file could carry anything). */
function checkIds(ids: readonly number[], field: string): void {
  ids.forEach((id, i) => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`fetch.${field}[${i}]: expected a positive integer OSM id, got ${JSON.stringify(id)}`)
  })
}

/** The Overpass query for a station's pinned elements. A station with only `osmWays` gets the one query it always had. */
export function overpassQuery(wanted: Pick<AuthoredStation['fetch'], 'osmWays' | 'osmLines' | 'osmNodes'>): string {
  const lines = wanted.osmLines ?? []
  const nodes = wanted.osmNodes ?? []
  if (wanted.osmWays.length === 0) throw new Error('fetch.osmWays: expected at least one OSM way id')
  checkIds(wanted.osmWays, 'osmWays')
  checkIds(lines, 'osmLines')
  checkIds(nodes, 'osmNodes')
  if (lines.length === 0 && nodes.length === 0) return `${HEADER}way(id:${wanted.osmWays.join(',')});out geom meta;`
  const parts = [`way(id:${[...wanted.osmWays, ...lines].join(',')});`, ...(nodes.length > 0 ? [`node(id:${nodes.join(',')});`] : [])]
  return `${HEADER}(${parts.join('')});out geom meta;`
}

function elements(json: unknown): Record<string, unknown>[] {
  return list(record(json, 'overpass').elements, 'overpass.elements').map((e, i) => record(e, `overpass.elements[${i}]`))
}

function keptTags(raw: unknown, at: string): Record<string, string> {
  const tags = record(raw ?? {}, `${at}.tags`)
  return Object.fromEntries(KEPT_ELEMENT_TAGS.filter((k) => typeof tags[k] === 'string').map((k) => [k, tags[k] as string]))
}

/** Overpass `out geom meta` JSON to the requested ways as polylines (in `ids` order): at least 2 points, open or closed. */
export function trimOverpassLines(json: unknown, ids: readonly number[]): OsmLine[] {
  const all = elements(json)
  return ids.map((id): OsmLine => {
    const el = all.find((e) => e.type === 'way' && e.id === id)
    if (!el) throw new Error(`overpass: way ${id} not in the response`)
    const at = `overpass way ${id}`
    const points = list(el.geometry, `${at}.geometry`).map((p, i): [number, number] => {
      const pt = record(p, `${at}.geometry[${i}]`)
      return [finite(pt.lat, `${at}.geometry[${i}].lat`), finite(pt.lon, `${at}.geometry[${i}].lon`)]
    })
    if (points.length < 2) throw new Error(`${at}: expected at least 2 points, got ${points.length}`)
    return { id, version: finite(el.version, `${at}.version`), timestamp: text(el.timestamp, `${at}.timestamp`), tags: keptTags(el.tags, at), points }
  })
}

/** Overpass `out geom meta` JSON to the requested nodes (in `ids` order). */
export function trimOverpassNodes(json: unknown, ids: readonly number[]): OsmNode[] {
  const all = elements(json)
  return ids.map((id): OsmNode => {
    const el = all.find((e) => e.type === 'node' && e.id === id)
    if (!el) throw new Error(`overpass: node ${id} not in the response`)
    const at = `overpass node ${id}`
    return {
      id,
      version: finite(el.version, `${at}.version`),
      timestamp: text(el.timestamp, `${at}.timestamp`),
      tags: keptTags(el.tags, at),
      lat: finite(el.lat, `${at}.lat`),
      lon: finite(el.lon, `${at}.lon`),
    }
  })
}
