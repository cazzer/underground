/** Screen rects one label layer leaves for another to keep clear of: the level labels write theirs each frame, the
 *  street labels read them (a frame late, which is invisible for DOM text). Scene owns one, like the band view. */
import { RECT } from './labelGeometry'

/** The most level labels an interior shows (a few levels); more are drawn but not kept clear of. */
export const MAX_LEVEL_BLOCKERS = 16

export interface LabelBlockers {
  /** `count` packed rects in canvas px (labelGeometry's RECT floats each: left, top, right, bottom). */
  rects: Float32Array
  count: number
  /** Bumped whenever the rects or their count change, so a reader can skip an unchanged frame. */
  version: number
}

export function createLabelBlockers(capacity = MAX_LEVEL_BLOCKERS): LabelBlockers {
  return { rects: new Float32Array(capacity * RECT), count: 0, version: 0 }
}
