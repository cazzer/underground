/**
 * Where station street layers (StationStreets.tsx) draw, so the basemap's roads step aside there: up to MASK_N discs,
 * each claimed by one mounted layer, read each frame by the basemap. Inside a layer's radius the roads fade out as the
 * station's streets fade in, over the exact complement of the layer's edge fade (streetBuffers.ts), so the two
 * cross-fade with no gap ring and no doubled stroke. Where discs overlap a road keeps the least alpha any one gives it.
 */
import { STREET_EDGE_FADE_M } from '../streetBuffers'

/** The mask's slot count: the shader's MASK_N define, so its uniform arrays and loop are this long. */
export const MASK_N = 4

export interface MaskSlot {
  /** A station street layer holds this slot. */
  claimed: boolean
  /** It has written its disc: only then do the roads give way. */
  present: boolean
  /** Its anchor, scene meters. */
  x: number
  z: number
  /** Its file's radius: past it the station layer draws nothing. */
  radiusM: number
  /** Its layer's own presence (0 to 1, easing in on join and out on leave): the roads give way by the reveal times this. */
  strength: number
}

export interface StreetMask {
  /** Always MASK_N long. */
  readonly slots: readonly MaskSlot[]
  /** A claim found every slot taken (logged once per mask). */
  fullLogged: boolean
}

export function createStreetMask(): StreetMask {
  const slots = Array.from({ length: MASK_N }, (): MaskSlot => ({ claimed: false, present: false, x: 0, z: 0, radiusM: 0, strength: 1 }))
  return { slots, fullLogged: false }
}

/** A free slot for a station street layer, or null (logged once) when every slot is taken: that layer's roads stay. */
export function claimMaskSlot(mask: StreetMask): number | null {
  const slot = mask.slots.findIndex((s) => !s.claimed)
  if (slot < 0) {
    if (!mask.fullLogged) console.warn(`Street mask: all ${MASK_N} slots are taken, so the basemap's roads stay under one station's streets`)
    mask.fullLogged = true
    return null
  }
  mask.slots[slot]!.claimed = true
  mask.slots[slot]!.strength = 1
  return slot
}

function claimedSlot(mask: StreetMask, slot: number): MaskSlot {
  const s = mask.slots[slot]
  if (!s?.claimed) throw new Error(`Street mask: slot ${slot} is not claimed`)
  return s
}

/** Moves a claimed slot's disc to a layer's anchor and radius. Throws on a slot not claimed. */
export function writeMaskSlot(mask: StreetMask, slot: number, x: number, z: number, radiusM: number): void {
  const s = claimedSlot(mask, slot)
  s.present = true
  s.x = x
  s.z = z
  s.radiusM = radiusM
}

/** Sets a claimed slot's own strength (its layer's presence, per frame). Throws on a slot not claimed. */
export function writeMaskStrength(mask: StreetMask, slot: number, strength: number): void {
  claimedSlot(mask, slot).strength = strength
}

/** Frees a claimed slot; the roads there come back. Throws on a slot not claimed. */
export function releaseMaskSlot(mask: StreetMask, slot: number): void {
  const s = claimedSlot(mask, slot)
  s.claimed = false
  s.present = false
}

/** Where the mask's ramp starts: the station layer's edge fade start. The ramp ends at the radius. */
export function maskInner(radiusM: number): number {
  return Math.max(radiusM - STREET_EDGE_FADE_M, 0)
}

/** One disc as the shader reads it: center, ramp start and end (meters), and the strength its layer draws at. */
export interface MaskDisc {
  x: number
  z: number
  inner: number
  outer: number
  strength: number
}

/**
 * One disc's term of the basemap road shader's mask (MASK_GLSL in basemapLineMaterial.ts): the alpha a road keeps at
 * `r` meters from the disc's center, with the station layer drawn at `strength` (its opacity). Change both together.
 */
export function maskAlpha(r: number, inner: number, outer: number, strength: number): number {
  const ramp = Math.min(Math.max((r - inner) / Math.max(outer - inner, 1e-3), 0), 1)
  return 1 - strength * (1 - ramp)
}

/** TS twin of MASK_GLSL's loop: the alpha a road keeps at ground point (x, z), the least over every disc. */
export function maskAlphaAt(x: number, z: number, discs: readonly MaskDisc[]): number {
  let a = 1
  for (const d of discs) a = Math.min(a, maskAlpha(Math.hypot(x - d.x, z - d.z), d.inner, d.outer, d.strength))
  return a
}
