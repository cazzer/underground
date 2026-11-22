/** Which OSM ways the street layer treats as streets. Pure: the street-file build (scripts/) and the
 *  client share it, so the entrance join and the drawn streets agree on what a street is.
 *  Loaded by a scripts/ test, so imports use explicit `.ts` paths. */
import { searchTokens } from './searchText.ts'

/** The `highway=` classes a car or pedestrian street can have, drawn and eligible for an entrance's street.
 *  `pedestrian` is here on purpose: a pedestrianised street (Fulton Mall, Stone St) is a street when it is a line.
 *  Never roadways: motorway and motorway_link (no sidewalks onto them), footway, steps, path, cycleway. */
export const ROADWAY_HIGHWAYS: ReadonlySet<string> = new Set([
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'residential',
  'unclassified',
  'living_street',
  'service',
  'pedestrian',
])

/** What the classes need to know about a way: its tags, not its geometry. */
export interface WayTags {
  highway: string
  name: string | null
}

/** A ring in a node-index list: four or more entries, first equal to last. */
export function isClosedRing(nodes: readonly number[]): boolean {
  return nodes.length >= 4 && nodes[0] === nodes[nodes.length - 1]
}

/** A pedestrian plaza: a closed `highway=pedestrian` way. A closed residential loop is a street, not an area.
 *  `closed` is `isClosedRing(way.nodes)` for a street file's way, or the same test on points. */
export function isArea(way: WayTags, closed: boolean): boolean {
  return closed && way.highway === 'pedestrian'
}

/** A way an entrance can open onto and the map draws as a street: named (a name that reduces to no search tokens,
 *  like "..." or "The", is no name, since the join keys streets by those tokens), a roadway class, not an area. */
export function isStreet(way: WayTags, closed: boolean): boolean {
  return (
    way.name !== null && searchTokens(way.name).length > 0 && ROADWAY_HIGHWAYS.has(way.highway) && !isArea(way, closed)
  )
}
