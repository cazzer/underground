import { useEffect, useRef } from 'react'
import { Vector3, type Camera } from 'three'
import { claimBlockerSlot, MAX_LEVEL_BLOCKERS, releaseBlockerSlot, writeBlocker, type LabelBlockers } from '../lib/labelBlockers'
import type { AmenityFrame } from './amenityFrame'

const corner = new Vector3()

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
 * Writes the screen rect (canvas px) of each mark's plate on screen into the slot, the first MAX_LEVEL_BLOCKERS in mark
 * order, so the street labels keep clear of them; bumps the version only on a change. The plate's four corners are
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
  let count = 0
  let changed = false
  for (let i = 0; i < f.marks.length && count < MAX_LEVEL_BLOCKERS; i++) {
    // Far past the view's target a mark can't be on screen: skip its projections.
    if (Math.abs(f.x[i]! - target.x) > reachM || Math.abs(f.z[i]! - target.z) > reachM) continue
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
