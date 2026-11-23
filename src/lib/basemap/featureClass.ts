/**
 * Which drawn class a Protomaps basemap (v4) feature falls in, or null to drop it. Roads split by kind, minus
 * tunnels (they run under the street), sidewalks and crossings (OSM footway=sidewalk|crossing, which v4 carries as
 * the path's `kind_detail`: they double every street they run beside), and rail, ferry, aerialway and aeroway
 * lines; water areas and rivers; park-like landuse. Earth and every point are dropped.
 */

export const BASEMAP_CLASSES = ['highway', 'major', 'minor', 'path', 'water', 'park'] as const
export type BasemapClass = (typeof BASEMAP_CLASSES)[number]

const ROAD_CLASSES: ReadonlySet<BasemapClass> = new Set(['highway', 'major', 'minor', 'path'])

/** The road classes: the station's streets redraw them (the mask) and the route lines cut them (routeClip.ts). */
export function isRoadClass(cls: BasemapClass): boolean {
  return ROAD_CLASSES.has(cls)
}

/** The classes the station street layers' mask fades (Basemap.tsx): the streets they redraw. Not paths: a station layer
 *  draws no footway or park path (streetBuffers keeps `isStreet` ways), so masking them would empty the disc of them. */
export function isMaskedClass(cls: BasemapClass): boolean {
  return cls !== 'path' && isRoadClass(cls)
}

/** MVT geometry types: 0 unknown, 1 point, 2 line, 3 polygon. */
export type GeomType = 0 | 1 | 2 | 3

export type FeatureProps = Readonly<Record<string, number | string | boolean>>

const ROAD_CLASS: Readonly<Record<string, BasemapClass>> = {
  highway: 'highway',
  major_road: 'major',
  minor_road: 'minor',
  path: 'path',
}

/** Paths that only shadow a street: a sidewalk beside it, a crossing over it. Park paths, footways and steps stay. */
const STREET_PATH_DETAILS: ReadonlySet<string> = new Set(['sidewalk', 'crossing'])

/** Water areas drawn as outlines; pools, fountains and reefs are left out. */
const WATER_AREA_KINDS: ReadonlySet<string> = new Set(['water', 'ocean', 'lake', 'river', 'basin', 'dock', 'reservoir'])
/** Water lines; the bay and strait lines are label paths, not water. */
const WATER_LINE_KINDS: ReadonlySet<string> = new Set(['river', 'canal', 'stream'])

/** Public green space; lawns, gardens, woods and pitches are too many and mostly inside these. */
export const PARK_KINDS: ReadonlySet<string> = new Set([
  'park',
  'national_park',
  'nature_reserve',
  'protected_area',
  'golf_course',
  'cemetery',
  'recreation_ground',
  'village_green',
  'dog_park',
  'zoo',
])

export function classOf(layer: string, type: GeomType, props: FeatureProps): BasemapClass | null {
  const kind = props.kind
  if (typeof kind !== 'string') return null
  if (layer === 'roads') {
    if (type !== 2 || props.is_tunnel === true) return null
    if (kind === 'path' && typeof props.kind_detail === 'string' && STREET_PATH_DETAILS.has(props.kind_detail)) return null
    return ROAD_CLASS[kind] ?? null
  }
  if (layer === 'water') {
    if (type === 3) return WATER_AREA_KINDS.has(kind) ? 'water' : null
    if (type === 2) return WATER_LINE_KINDS.has(kind) ? 'water' : null
    return null
  }
  if (layer === 'landuse') return type === 3 && PARK_KINDS.has(kind) ? 'park' : null
  return null
}
