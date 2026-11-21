/**
 * Shared-corridor bands for a built network. The corridor search is the costly part of a build, so the first
 * paint draws network.shapes without bands and these arrive later (src/data/loadBands.ts runs the search in a
 * worker). Pure.
 */
import type { ShapeId } from '../data/schema'
import { corridorBands, type ShapeBands } from './corridors'
import { drawnPath, type Network, type ShapePath } from './network'

export interface BandedShapes {
  /** network.shapes with their bands, in the same order; a shape that shares no corridor is the same object. */
  shapes: readonly ShapePath[]
  shapeById: ReadonlyMap<ShapeId, ShapePath>
  /** Bands of each shape that shares a corridor. */
  bands: ReadonlyMap<ShapeId, ShapeBands>
}

/** network's shapes redrawn with `bands` (corridorBands over network.trackLines). */
export function bandShapes(network: Network, bands: ReadonlyMap<ShapeId, ShapeBands>): BandedShapes {
  const shapes = network.shapes.map((s, i) => {
    const b = bands.get(s.id)
    return b ? drawnPath(s, network.trackLines[i]!.line, s.profile, b, network.platformSpans) : s
  })
  return { shapes, shapeById: new Map(shapes.map((s) => [s.id, s])), bands }
}

/** The whole band step on this thread: the tests' and the worker fallback's. */
export function bandNetwork(network: Network): BandedShapes {
  return bandShapes(network, corridorBands(network.trackLines, network.routes))
}
