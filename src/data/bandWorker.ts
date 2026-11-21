/**
 * Web worker: the corridor search (corridors.ts) off the main thread, so it never delays the first paint or
 * holds up input. loadBands.ts posts the track lines flattened to transferable arrays and gets the bands back.
 */
import { corridorBands, type CorridorRoute, type ShapeBands } from '../lib/corridors'
import type { Ground } from '../lib/projection'
import { buildPolyline } from '../lib/realtime/polyline'
import type { Direction, RouteId, ShapeId } from './schema'

export interface BandRequest {
  shapes: { id: ShapeId; routeId: RouteId; direction: Direction; primary: boolean; xz: Float64Array }[]
  routes: CorridorRoute[]
}

export type BandResponse = { bands: [ShapeId, ShapeBands][] } | { error: string }

/** The worker global, typed for the two members this uses (the project's lib is DOM, not WebWorker). */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<BandRequest>) => void) | null
  postMessage(message: BandResponse): void
}

scope.onmessage = (e) => {
  try {
    const shapes = e.data.shapes.map((s) => {
      const points: Ground[] = []
      for (let i = 0; i < s.xz.length; i += 2) points.push({ x: s.xz[i]!, z: s.xz[i + 1]! })
      return { id: s.id, routeId: s.routeId, direction: s.direction, primary: s.primary, line: buildPolyline(points) }
    })
    scope.postMessage({ bands: [...corridorBands(shapes, e.data.routes)] })
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err) })
  }
}
