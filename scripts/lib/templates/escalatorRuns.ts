/** Plan runs for template-placed escalators: an E&E row gives one point, which the renderer would stand nearly
 *  upright at the drawn (exaggerated) height, so the template gives each escalator ends of its own. Pure. */
import type { LevelKind } from '../../../src/data/stationSchema.ts'
import type { FramePoint } from '../stationInputs.ts'
import { DRAWN_Y_SCALE, RUN_PER_RISE } from './stairs.ts'

/** A 30 degree incline at the drawn rise: run = drawn rise / tan 30. */
export const ESCALATOR_RUN_PER_DRAWN_RISE = Math.sqrt(3)
const SHORTEN_STEP_M = 1
const MAX_LATERAL_SLOTS = 8
/** When a row across is full, the start end moves back (then forward) along the run by these. */
const LONGITUDINAL_SHIFTS_M = [0, -3, 3, -6, 6, -9, 9]

export interface RunSite {
  /** The end the run starts from: the street end (at its entrance) or the slab end of a mezzanine-platform one. */
  a: FramePoint
  aKind: LevelKind
  bKind: LevelKind
  aFits: (p: FramePoint) => boolean
  bFits: (p: FramePoint) => boolean
  /** Unit plan directions to try, in order. */
  dirs: FramePoint[]
}

export const unitToward = (from: FramePoint, to: FramePoint): FramePoint | null => {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1])
  return d < 1e-6 ? null : [(to[0] - from[0]) / d, (to[1] - from[1]) / d]
}

/** The first run that lands: slots side by side across the run (0, +1, -1, ... × `step`), each direction, from the
 *  full length down to RUN_PER_RISE × rise in 1 m steps; then the same with the start moved along the run. `clear` rejects ends too close to the bank so far. */
export function placeRun(site: RunSite, riseM: number, step: number, clear: (p: FramePoint) => boolean): { a: FramePoint; b: FramePoint } | null {
  const full = ESCALATOR_RUN_PER_DRAWN_RISE * DRAWN_Y_SCALE * riseM
  const shortest = RUN_PER_RISE * riseM
  for (const shift of LONGITUDINAL_SHIFTS_M) {
    for (let k = 0; k <= 2 * MAX_LATERAL_SLOTS; k++) {
      const lateral = (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * step
      for (const [du, dv] of site.dirs) {
        const a: FramePoint = [site.a[0] - dv * lateral + du * shift, site.a[1] + du * lateral + dv * shift]
        if (!site.aFits(a) || !clear(a)) continue
        for (let len = full; len >= shortest - 1e-9; len -= SHORTEN_STEP_M) {
          const b: FramePoint = [a[0] + du * len, a[1] + dv * len]
          if (site.bFits(b) && clear(b)) return { a, b }
        }
      }
    }
  }
  return null
}
