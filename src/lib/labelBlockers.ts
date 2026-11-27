/** Screen rects one label layer leaves for another to keep clear of: each drawn interior's level labels write theirs
 *  each frame into a slot they claim, as do the amenity marks (StationAmenities.tsx, enp.5); the street labels read
 *  every slot (a frame late, which is invisible for DOM text). Scene owns one, like the band view. Pure. */
import { RECT } from './labelGeometry'
import { MAX_VIEW_INTERIORS } from './viewStations'

/** The most rects one slot holds (an interior's few level labels, or the amenity marks on screen); more are drawn but not kept clear of. */
export const MAX_LEVEL_BLOCKERS = 16
/** One slot per interior drawn at once (o3r.4), plus one for the amenity marks. */
export const BLOCKER_SLOTS = MAX_VIEW_INTERIORS + 1

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
    console.warn(`Label blockers: all ${BLOCKER_SLOTS} slots are held; the street labels may cover one layer's marks or labels`)
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

/** Writes packed rect `r` (canvas px) and says whether it changed. Allocation-free (per frame). */
export function writeBlocker(rects: Float32Array, r: number, left: number, top: number, right: number, bottom: number): boolean {
  const o = r * RECT
  // Float32 storage: compare after the write's rounding.
  const was0 = rects[o]
  const was1 = rects[o + 1]
  const was2 = rects[o + 2]
  const was3 = rects[o + 3]
  rects[o] = left
  rects[o + 1] = top
  rects[o + 2] = right
  rects[o + 3] = bottom
  return rects[o] !== was0 || rects[o + 1] !== was1 || rects[o + 2] !== was2 || rects[o + 3] !== was3
}
