/**
 * The out-of-service machines a landing frames (pathFrame.ts): each one's two ends exactly where the interior draws them
 * (`planEnds`: an elevator's shaft at both its stops, an escalator's band ends, a zero-run one laid by its bank). Pure.
 */
import type { StationInterior } from '../data/stationSchema'
import type { FramePoint } from './freeFrame'
import { planEnds } from './interiorConnectors'
import { connectorContext, STEP_RISE_M } from './interiorGeometry'
import type { Ground } from './projection'

/** The parts of an interior model the outage frame reads (InteriorModel has them). */
export interface OutageFrameModel {
  interior: StationInterior
  /** Scene position of the interior's local origin. */
  origin: Ground
}

/**
 * Scene points (y × `yScale`, before the depth factor) of the ends of each machine in `outIds`, in `outIds` order, lower
 * end first; an id the interior has no elevator or escalator for adds none.
 */
export function outageFramePoints(model: OutageFrameModel, outIds: readonly string[], yScale: number): FramePoint[] {
  const { interior, origin } = model
  if (outIds.length === 0) return []
  const ctx = connectorContext(interior, { yScale, stepRise: STEP_RISE_M, colorOf: () => [0, 0, 0] })
  const levelIndex = (id: string) => interior.levels.findIndex((l) => l.id === id)
  const at = (x: number, z: number, li: number): FramePoint => ({ x: origin.x + x, y: interior.levels[li]!.y * yScale, z: origin.z + z })
  return outIds.flatMap((id) => {
    const c = interior.connectors.find((k) => k.id === id && (k.kind === 'elevator' || k.kind === 'escalator'))
    if (!c) return []
    const [li, ui] = [levelIndex(c.lower.level), levelIndex(c.upper.level)]
    const { lower, upper } = planEnds(ctx, c, li, ui)
    return [at(lower[0], lower[1], li), at(upper[0], upper[1], ui)]
  })
}
