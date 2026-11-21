/** What every template step shares: the station's frame (anchor and bearing from the classifier), its platform
 *  polygons in that frame, and small geometry helpers. Pure. All [u, v] here are AuthoredStation frame points. */
import { toGround } from '../../../src/lib/projection.ts'
import type { Ground, LatLon } from '../../../src/lib/projection.ts'
import type { GeneratedInfo } from '../../../src/data/stationSchema.ts'
import type { ArchetypeParams, PlatformLayout } from '../archetype.ts'
import type { CatalogStation, OsmCatalogWay } from '../catalogTypes.ts'
import { fromUV, toUV } from '../platformAxis.ts'
import { distanceToRing, roundM } from '../stationGeometry.ts'
import type { FramePoint } from '../stationInputs.ts'

/** A landing counts as on a polygon this close to it (the merge allows 0.5 m; its output is rounded to 1 cm). */
export const INSIDE_M = 0.4

export interface PlatformGeom {
  /** Index, in v order, of the physical platform (one PlatformLayout, maybe several OSM ways). */
  index: number
  kind: PlatformLayout['kind']
  edges: PlatformLayout['edges']
  ways: { id: number; ring: FramePoint[] }[]
  uRange: [number, number]
  vRange: [number, number]
  /** The classifier's centerline, v from the frame origin. */
  centerV: number
}

export interface TemplateCtx {
  stationId: string
  name: string
  row: CatalogStation
  archetype: GeneratedInfo['archetype']
  confidence: number
  params: ArchetypeParams
  anchor: LatLon
  bearingDeg: number
  uv: (lat: number, lon: number) => FramePoint
  /** Citywide scene ground point (what the map draws in) of a frame point: toGround(anchor) plus the local offset. */
  world: (p: FramePoint) => Ground
  platforms: PlatformGeom[]
  /** Platform u-range over every platform. */
  uSpan: [number, number]
}

const range = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)]

export function makeCtx(
  row: CatalogStation,
  result: { archetype: GeneratedInfo['archetype']; confidence: number; params: ArchetypeParams },
  platformWays: ReadonlyMap<number, OsmCatalogWay>,
): TemplateCtx {
  const { params } = result
  const anchor = params.anchor
  const axis = { bearingDeg: params.bearingDeg, origin: [0, 0] as [number, number] }
  const uv = (lat: number, lon: number): FramePoint => {
    const g = toGround({ lat, lon }, anchor)
    return toUV([g.x, g.z], axis)
  }
  const base = toGround(anchor)
  const world = (p: FramePoint): Ground => {
    const [x, z] = fromUV(p, axis)
    return { x: base.x + x, z: base.z + z }
  }
  const platforms = [...params.platforms]
    .sort((a, b) => a.centerV - b.centerV || a.uRange[0] - b.uRange[0])
    .map((layout, index): PlatformGeom => {
      const ways = layout.osmWays.map((id) => {
        const way = platformWays.get(id)
        if (!way) throw new Error(`platform way ${id} is not in the catalog`)
        return { id, ring: way.points.slice(0, -1).map(([lat, lon]) => uv(lat, lon)) }
      })
      const pts = ways.flatMap((w) => w.ring)
      return {
        index,
        kind: layout.kind,
        edges: layout.edges,
        ways,
        uRange: range(pts.map((p) => p[0])),
        vRange: range(pts.map((p) => p[1])),
        centerV: layout.centerV,
      }
    })
  if (platforms.length === 0) throw new Error('no platform layouts')
  return {
    stationId: row.gtfsStopId,
    name: row.name,
    row,
    archetype: result.archetype,
    confidence: result.confidence,
    params,
    anchor,
    bearingDeg: params.bearingDeg,
    uv,
    world,
    platforms,
    uSpan: [Math.min(...platforms.map((p) => p.uRange[0])), Math.max(...platforms.map((p) => p.uRange[1]))],
  }
}

export const roundUV = (p: FramePoint): FramePoint => [roundM(p[0]), roundM(p[1])]

export function onPlatform(p: PlatformGeom, at: FramePoint): boolean {
  return p.ways.some((w) => distanceToRing(at, w.ring) <= INSIDE_M)
}

/** The platform's middle across at `u` (midway between its outermost edges there), or null where no polygon
 *  of it reaches u. Follows a curved platform, unlike the classifier's straight `centerV`. */
export function centerAt(p: PlatformGeom, u: number): number | null {
  const vs: number[] = []
  for (const w of p.ways) {
    for (let i = 0; i < w.ring.length; i++) {
      const a = w.ring[i]!
      const b = w.ring[(i + 1) % w.ring.length]!
      if (a[0] === b[0] || (u - a[0]) * (u - b[0]) > 0) continue
      vs.push(a[1] + ((b[1] - a[1]) * (u - a[0])) / (b[0] - a[0]))
    }
  }
  return vs.length < 2 ? null : (Math.min(...vs) + Math.max(...vs)) / 2
}

/** The first point on `p`'s centerline, starting at u and stepping 2 m alternately outward, that lies on the
 *  platform polygon; `accept` can reject a point (for a minimum run). Null when none does. */
export function searchCenterline(p: PlatformGeom, u: number, accept: (at: FramePoint) => boolean = () => true): FramePoint | null {
  const [u0, u1] = p.uRange
  const start = Math.max(u0, Math.min(u1, u))
  const steps = Math.ceil((u1 - u0) / 2) + 1
  for (let k = 0; k <= 2 * steps; k++) {
    const du = (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * 2
    const cu = start + du
    if (cu < u0 || cu > u1) continue
    const v = centerAt(p, cu)
    if (v === null) continue
    const cand: FramePoint = [cu, v]
    if (onPlatform(p, cand) && accept(cand)) return roundUV(cand)
  }
  return null
}

export const dist = (a: FramePoint, b: FramePoint): number => Math.hypot(a[0] - b[0], a[1] - b[1])
