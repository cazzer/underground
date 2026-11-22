/** When the street and entrance labels show, and how far out. Pure. */
import type { Viewport } from './framing'
import { labelOpacity } from './interiorReveal'

/**
 * Street label opacity: the street layer's opacity (the interior reveal's) gated on the depth factor exactly as the
 * level labels are (LABELS_FROM_DEPTH to LABELS_FULL_DEPTH in interiorReveal.ts), so every label in the station view
 * arrives together, once the view has tipped enough to read as a place rather than a plan.
 */
export function streetLabelOpacity(opacity: number, depth: number): number {
  return labelOpacity(opacity, depth)
}

/** A phone: its shorter viewport side is under this many px. */
const PHONE_MAX_SIDE_PX = 600
export const PHONE_LABEL_RADIUS_M = 150
export const DESKTOP_LABEL_RADIUS_M = 250

/** How far from the station a street label may sit, meters: closer on a phone, whose screen holds fewer. */
export function streetLabelRadiusM(viewport: Viewport): number {
  return Math.min(viewport.width, viewport.height) < PHONE_MAX_SIDE_PX ? PHONE_LABEL_RADIUS_M : DESKTOP_LABEL_RADIUS_M
}
