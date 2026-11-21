import { E5, canonicalShapeId, deltaEncode } from '../../src/data/codec.ts'
import type { Direction, RouteId, Shape, ShapeId } from '../../src/data/schema.ts'
import { toGround } from '../../src/lib/projection.ts'
import { compareIds, type GtfsFeed, type ShapePointRow } from './gtfs.ts'
import { simplifyIndices } from './simplify.ts'

interface ShapeUse {
  routeId: RouteId
  direction: Direction
  trips: number
}

function collectUses(feed: GtfsFeed): Map<ShapeId, ShapeUse> {
  const uses = new Map<ShapeId, ShapeUse>()
  for (const trip of feed.trips) {
    if (trip.shapeId === '') continue
    const id = canonicalShapeId(trip.shapeId)
    const use = uses.get(id)
    if (!use) {
      uses.set(id, { routeId: trip.routeId, direction: trip.direction, trips: 1 })
    } else if (use.routeId !== trip.routeId || use.direction !== trip.direction) {
      throw new Error(`Shape ${id} is used by more than one route or direction`)
    } else {
      use.trips++
    }
  }
  return uses
}

function groupPoints(feed: GtfsFeed, wanted: ReadonlyMap<ShapeId, ShapeUse>): Map<ShapeId, ShapePointRow[]> {
  const groups = new Map<ShapeId, ShapePointRow[]>()
  for (const point of feed.shapePoints) {
    const id = canonicalShapeId(point.shapeId)
    if (!wanted.has(id)) continue
    const group = groups.get(id)
    if (group) group.push(point)
    else groups.set(id, [point])
  }
  return groups
}

/** Every shape that some trip references, simplified and delta-encoded as 1e-5 degrees. */
export function buildShapes(feed: GtfsFeed, toleranceM: number): Shape[] {
  const uses = collectUses(feed)
  const groups = groupPoints(feed, uses)
  const best = new Map<string, { id: ShapeId; trips: number }>()
  const shapes: Shape[] = []
  for (const id of [...uses.keys()].sort(compareIds)) {
    const use = uses.get(id)!
    const points = groups.get(id)
    if (!points || points.length === 0) throw new Error(`Shape ${id} has trips but no points in shapes.txt`)
    points.sort((a, b) => a.sequence - b.sequence)
    const kept = simplifyIndices(points.map((p) => toGround(p)), toleranceM).map((i) => points[i]!)
    shapes.push({
      id,
      routeId: use.routeId,
      direction: use.direction,
      primary: false,
      lat: deltaEncode(kept.map((p) => Math.round(p.lat * E5))),
      lon: deltaEncode(kept.map((p) => Math.round(p.lon * E5))),
    })
    const group = `${use.routeId}|${use.direction}`
    // Ids ascend, so a strict > keeps the smaller id on ties.
    if (use.trips > (best.get(group)?.trips ?? 0)) best.set(group, { id, trips: use.trips })
  }
  const primaryIds = new Set([...best.values()].map((b) => b.id))
  for (const shape of shapes) shape.primary = primaryIds.has(shape.id)
  return shapes
}
