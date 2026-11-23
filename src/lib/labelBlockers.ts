/** Screen rects one label layer leaves for another to keep clear of: each drawn interior's level labels write theirs
 *  each frame into a slot they claim, the street labels read every slot (a frame late, which is invisible for DOM
 *  text). Scene owns one, like the band view. Pure. */
import { RECT } from './labelGeometry'
import { MAX_VIEW_INTERIORS } from './viewStations'

/** The most level labels one interior shows (a few levels); more are drawn but not kept clear of. */
export const MAX_LEVEL_BLOCKERS = 16
/** One slot per interior drawn at once (o3r.4). */
export const BLOCKER_SLOTS = MAX_VIEW_INTERIORS

export interface LabelBlockers {
  /** Slot s's packed rects start at rect s * MAX_LEVEL_BLOCKERS, in canvas px (labelGeometry's RECT floats each: left, top, right, bottom). */
  rects: Float32Array
  /** Rects in use per slot. */
  counts: Int32Array
  /** 1 while a layer holds the slot. */
  claimed: Uint8Array
  /** Bumped whenever any slot's rects or count change, so a reader can skip an unchanged frame. */
  version: number
  /** A full set has been reported (once a session). */
  fullLogged: boolean
}

export function createLabelBlockers(): LabelBlockers {
  return {
    rects: new Float32Array(BLOCKER_SLOTS * MAX_LEVEL_BLOCKERS * RECT),
    counts: new Int32Array(BLOCKER_SLOTS),
    claimed: new Uint8Array(BLOCKER_SLOTS),
    version: 0,
    fullLogged: false,
  }
}

/** A free slot, now held; null when every slot is held (that layer's labels are then not kept clear of; warned once). */
export function claimBlockerSlot(b: LabelBlockers): number | null {
  for (let s = 0; s < BLOCKER_SLOTS; s++) {
    if (b.claimed[s] === 1) continue
    b.claimed[s] = 1
    b.counts[s] = 0
    return s
  }
  if (!b.fullLogged) {
    b.fullLogged = true
    console.warn(`Level labels: all ${BLOCKER_SLOTS} blocker slots are held; the street labels may cover one interior's`)
  }
  return null
}

/** Frees a held slot and empties it. Throws for a slot not held (a bug: a double release). */
export function releaseBlockerSlot(b: LabelBlockers, slot: number): void {
  if (b.claimed[slot] !== 1) throw new Error(`Level label blocker slot ${slot} is not held`)
  b.claimed[slot] = 0
  b.counts[slot] = 0
  b.version++
}
