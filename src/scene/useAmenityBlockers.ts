import { useEffect, useRef } from 'react'
import { Vector3, type Camera } from 'three'
import { claimBlockerSlot, MAX_LEVEL_BLOCKERS, releaseBlockerSlot, writeBlocker, type LabelBlockers } from '../lib/labelBlockers'
import type { AmenityFrame } from './amenityFrame'

const corner = new Vector3()
/** The marks nearest the target, in order, ranked before projecting: twice the slot's room, for those off screen. */
const RANKED = MAX_LEVEL_BLOCKERS * 2
const rankedIdx = new Int32Array(RANKED)
const rankedD = new Float32Array(RANKED)

/** Holds one LabelBlockers slot while mounted (null when every slot is held). */
export function useAmenityBlockerSlot(blockers: LabelBlockers): React.RefObject<number | null> {
  const slot = useRef<number | null>(null)
  useEffect(() => {
    const held = claimBlockerSlot(blockers)
    slot.current = held
    return () => {
      slot.current = null
      if (held !== null) releaseBlockerSlot(blockers, held)
    }
  }, [blockers])
  return slot
}

/** Empties the slot (the marks are hidden). */
export function clearAmenityBlockers(blockers: LabelBlockers, slot: number | null): void {
  if (slot === null || blockers.counts[slot] === 0) return
  blockers.counts[slot] = 0
  blockers.version++
}

/**
 * Writes the screen rect (canvas px) of each mark's plate on screen into the slot, the MAX_LEVEL_BLOCKERS nearest the
 * view's target, so the street labels keep clear of them; bumps the version only on a change. The plate's four corners are
 * projected, yawed by `az` as the frame drew them, half size `plateM`; marks farther than `reachM` from the view's
 * `target` (on either axis) are skipped unprojected. Allocation-free (per frame).
 */
export function writeAmenityBlockers(
  blockers: LabelBlockers,
  slot: number | null,
  f: AmenityFrame,
  camera: Camera,
  width: number,
  height: number,
  az: number,
  plateM: number,
  target: { x: number; z: number },
  reachM: number,
): void {
  if (slot === null) return
  const c = Math.cos(az) * plateM
  const s = Math.sin(az) * plateM
  const base = slot * MAX_LEVEL_BLOCKERS
  // Rank the marks within reach by ground distance to the target (insertion into a short sorted list).
  let ranked = 0
  for (let i = 0; i < f.marks.length; i++) {
    const dx = f.x[i]! - target.x
    const dz = f.z[i]! - target.z
    // Far past the view's target a mark can't be on screen: skip it unranked.
    if (Math.abs(dx) > reachM || Math.abs(dz) > reachM) continue
    const d2 = dx * dx + dz * dz
    if (ranked === RANKED && d2 >= rankedD[RANKED - 1]!) continue
    let at = ranked < RANKED ? ranked++ : RANKED - 1
    while (at > 0 && rankedD[at - 1]! > d2) {
      rankedD[at] = rankedD[at - 1]!
      rankedIdx[at] = rankedIdx[at - 1]!
      at--
    }
    rankedD[at] = d2
    rankedIdx[at] = i
  }
  let count = 0
  let changed = false
  for (let r = 0; r < ranked && count < MAX_LEVEL_BLOCKERS; r++) {
    const i = rankedIdx[r]!
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    let behind = false
    for (let k = 0; k < 4; k++) {
      const a = k & 1 ? 1 : -1
      const b = k & 2 ? 1 : -1
      // Local x is (cos, -sin), local z (sin, cos), each times the plate's half size.
      corner.set(f.x[i]! + a * c + b * s, 0, f.z[i]! - a * s + b * c).project(camera)
      if (corner.z > 1) behind = true
      const px = ((corner.x + 1) / 2) * width
      const py = ((1 - corner.y) / 2) * height
      left = Math.min(left, px)
      right = Math.max(right, px)
      top = Math.min(top, py)
      bottom = Math.max(bottom, py)
    }
    if (behind || right < 0 || left > width || bottom < 0 || top > height) continue
    changed = writeBlocker(blockers.rects, base + count++, left, top, right, bottom) || changed
  }
  if (changed || count !== blockers.counts[slot]) {
    blockers.counts[slot] = count
    blockers.version++
  }
}
