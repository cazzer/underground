/** The collapse data tests' phone: a 390×844 viewport with the station or trip panel collapsed to its bar (2q7.34). */
import type { FreeFrame, FreeFrameInput } from './freeFrame'
import type { Viewport } from './framing'
import type { ScreenRect } from './interiorCamera'
import { priorityLanding, type PriorityFrame } from './pathFrame'

type View = Pick<FreeFrameInput, 'azimuth' | 'viewport' | 'free' | 'fovDeg'>
type Landing = Pick<FreeFrame, 'distance' | 'target'>

export const COLLAPSE_FOV = 35

/** The free rect above the collapsed bar, measured on the app (the same for the station and the trip panel). */
export const PHONE_COLLAPSED: { viewport: Viewport; free: ScreenRect } = {
  viewport: { width: 390, height: 844 },
  free: { left: 0, top: 60, right: 390, bottom: 690 },
}

/**
 * The collapse reframe's destination at `azimuth` (the landing's, kept: no turn), as interiorFlight frames it with the
 * panel collapsed: `plain` is the interior framed as usual in a view (frameInterior).
 */
export function collapsedLanding(frame: PriorityFrame, plain: (view: View) => Landing, azimuth: number): { view: View; next: Landing } {
  const view = { azimuth, viewport: PHONE_COLLAPSED.viewport, free: PHONE_COLLAPSED.free, fovDeg: COLLAPSE_FOV }
  return { view, next: priorityLanding(frame, view, plain(view)) }
}
