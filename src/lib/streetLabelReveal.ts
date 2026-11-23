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

/** A phone-sized viewport: its shorter side is under PHONE_MAX_SIDE_PX. Entrance labels take two lines there. */
export function isPhoneViewport(viewport: Viewport): boolean {
  return Math.min(viewport.width, viewport.height) < PHONE_MAX_SIDE_PX
}

/** How far from the station a street label may sit, meters: closer on a phone, whose screen holds fewer. */
export function streetLabelRadiusM(viewport: Viewport): number {
  return isPhoneViewport(viewport) ? PHONE_LABEL_RADIUS_M : DESKTOP_LABEL_RADIUS_M
}

export interface LabelBudget {
  entrances: number
  streets: number
}

/** How many entrance and street labels each station but the focused one may place (o3r.6): `beside` a focused
 *  station (which is never budgeted), or `alone` when none is focused (every station is). A phone holds one entrance
 *  label beside the focused station's, two with none focused. */
export const NEIGHBOUR_LABEL_BUDGET: Record<'phone' | 'desktop', { beside: LabelBudget; alone: LabelBudget }> = {
  phone: { beside: { entrances: 1, streets: 1 }, alone: { entrances: 2, streets: 1 } },
  desktop: { beside: { entrances: 4, streets: 3 }, alone: { entrances: 4, streets: 3 } },
}

export function neighbourLabelBudget(viewport: Viewport, focused: boolean): LabelBudget {
  const sized = NEIGHBOUR_LABEL_BUDGET[isPhoneViewport(viewport) ? 'phone' : 'desktop']
  return focused ? sized.beside : sized.alone
}
