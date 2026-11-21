/** Layout facts from a GTFS pathways graph, per GTFS station, as an offline cross-check for the archetype
 *  classifier (scripts/score-archetypes.ts). Pure; the feed is read by the script and never shipped.
 *  Nodes: platforms are stop ids like "601N" (three characters then N or S) and belong to the station named
 *  by those three characters; location_type 2 is an entrance, 3 a generic node (mezzanine, landing).
 *  A vertical link is pathway_mode 2 (stairs), 4 (escalator) or 5 (elevator) between a platform and
 *  anything else, in either direction. Walkways (1), fare gates (6) and exit gates (7) are not vertical
 *  and not used: the only question here is how people get from the street side up or down to a platform. */

export interface StationTopology {
  gtfsStationId: string
  platformNodes: string[]
  /** A platform is reached vertically from a generic node (not straight from an entrance). */
  hasMezzanine: boolean
  /** Distinct generic nodes that reach one of the station's platforms vertically. */
  mezzanineCount: number
  /** The two directions' vertical links reach disjoint sets of nodes. Null without both a N and a S platform. */
  perDirection: boolean | null
  /** One piece of equipment (same mta_equipment_id) reaches both a N and a S platform: an island platform. */
  sharedConnector: boolean
}

const PLATFORM_NODE = /^[A-Z0-9]{3}[NS]$/
const VERTICAL_MODES = new Set(['2', '4', '5'])

export function pathwaysTopology(stops: Record<string, string>[], pathways: Record<string, string>[]): Map<string, StationTopology> {
  const locationType = new Map(stops.map((s) => [s.stop_id ?? '', s.location_type ?? '']))
  const isGeneric = (id: string): boolean => locationType.get(id) === '3'
  const links = new Map<string, Set<string>>()
  const equipmentDirections = new Map<string, Set<string>>()
  const add = (platform: string, other: string, equipment: string): void => {
    if (!links.has(platform)) links.set(platform, new Set())
    links.get(platform)!.add(other)
    if (equipment !== '') {
      if (!equipmentDirections.has(equipment)) equipmentDirections.set(equipment, new Set())
      equipmentDirections.get(equipment)!.add(platform)
    }
  }
  for (const p of pathways) {
    if (!VERTICAL_MODES.has(p.pathway_mode ?? '')) continue
    const from = p.from_stop_id ?? ''
    const to = p.to_stop_id ?? ''
    const equipment = p.mta_equipment_id ?? ''
    if (PLATFORM_NODE.test(from) && !PLATFORM_NODE.test(to)) add(from, to, equipment)
    else if (PLATFORM_NODE.test(to) && !PLATFORM_NODE.test(from)) add(to, from, equipment)
  }

  const out = new Map<string, StationTopology>()
  for (const station of new Set([...links.keys()].map((n) => n.slice(0, 3)))) {
    const platformNodes = [...links.keys()].filter((n) => n.startsWith(station)).sort()
    const side = (d: string): Set<string> => new Set(platformNodes.filter((n) => n.endsWith(d)).flatMap((n) => [...links.get(n)!]))
    const north = side('N')
    const south = side('S')
    const generic = new Set(platformNodes.flatMap((n) => [...links.get(n)!]).filter(isGeneric))
    const hasBoth = north.size > 0 && south.size > 0
    out.set(station, {
      gtfsStationId: station,
      platformNodes,
      hasMezzanine: generic.size > 0,
      mezzanineCount: generic.size,
      perDirection: hasBoth ? [...north].every((n) => !south.has(n)) : null,
      sharedConnector: [...equipmentDirections.values()].some((nodes) => platformNodes.some((n) => nodes.has(n) && n.endsWith('N')) && platformNodes.some((n) => nodes.has(n) && n.endsWith('S'))),
    })
  }
  return out
}
