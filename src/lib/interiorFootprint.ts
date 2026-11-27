import type { LocalPoint, StationInterior } from '../data/stationSchema'
import type { Ground } from './projection'
import { paddedHull } from './interiorFraming'

/** How far the footprint reaches past the interior's outlines and entrances, meters. */
export const FOOTPRINT_PAD_M = 6
/** A wider pad than the pick footprint: the clearance a covered station's amenity row keeps off its interior (useAmenityCovers). */
export const FOCUS_FRAME_PAD_M = 14

/**
 * A drawn interior's ground footprint (o3r.7): the convex hull of its platform and slab outlines and its entrances,
 * grown by a pad, plus its vertical extent. A tap inside a neighbour's opens it.
 */
export interface Footprint {
  /** Scene position of the interior's local origin (its group). */
  originX: number
  originZ: number
  /** Group-local hull vertices, in order. */
  hull: LocalPoint[]
  /** The lowest and highest level (the street, 0, included), × yScale, before the depth factor. */
  yLow: number
  yHigh: number
}

/** Directions the pad is taken in: the hull of each point's octagon. */
const PAD_SIDES = 8
/** An octagon's circumradius that keeps its edges `pad` from its centre. */
const PAD_REACH = 1 / Math.cos(Math.PI / PAD_SIDES)

/**
 * The footprint of `interior` drawn at `origin` with depths × `yScale`. Every outline point and entrance lies at least
 * `pad` inside the hull. Throws, naming the station, when there are fewer than three distinct points to enclose.
 */
export function interiorFootprint(interior: StationInterior, yScale: number, origin: Ground, pad: number = FOOTPRINT_PAD_M): Footprint {
  const points: LocalPoint[] = [
    ...interior.platforms.flatMap((p) => p.outline),
    ...interior.slabs.flatMap((s) => s.outline),
    ...interior.entrances.map((e): LocalPoint => [e.x, e.z]),
  ]
  if (new Set(points.map(([x, z]) => `${x},${z}`)).size < 3) {
    throw new Error(`Interior ${interior.stationId} has too few outline points for a footprint`)
  }
  const grown: LocalPoint[] = []
  const r = pad * PAD_REACH
  for (const [x, z] of points) {
    for (let k = 0; k < PAD_SIDES; k++) {
      const a = (2 * Math.PI * k) / PAD_SIDES
      grown.push([x + r * Math.cos(a), z + r * Math.sin(a)])
    }
  }
  const ys = interior.levels.map((l) => l.y)
  return {
    originX: origin.x,
    originZ: origin.z,
    // A pad of 0 leaves paddedHull's plain convex hull.
    hull: paddedHull(grown, 0),
    yLow: Math.min(0, ...ys) * yScale,
    yHigh: Math.max(0, ...ys) * yScale,
  }
}
