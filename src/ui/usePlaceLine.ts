import { useCallback, useRef, useState, type RefObject } from 'react'
import { useFocus } from '../lib/focus'
import type { PlacePick } from '../lib/placeLabel'

/** The radius a place's point flight is asked to frame; its landing distance is PLACE_LANDING_DISTANCE (600 m, tilted), so only the request carries it. */
export const PLACE_VIEW_RADIUS_M = 250

export interface PlaceLine {
  /** The place the latest flight went to, while no later flight has replaced it. */
  shown: PlacePick | null
  /** Flies to the place and shows its line. */
  show: (pick: PlacePick) => void
  clear: () => void
  lineRef: RefObject<HTMLParagraphElement | null>
}

/**
 * The HUD's picked-place line. It lasts while its flight is still the latest one: a station pick, "Go to", a
 * location fix or another place replaces it, a pan or an auto-focused station on zooming in does not.
 */
export function usePlaceLine(): PlaceLine {
  const { flyRequest, flyToPoint } = useFocus()
  const [state, setState] = useState<{ pick: PlacePick; nonce: number } | null>(null)
  const lineRef = useRef<HTMLParagraphElement>(null)
  const show = useCallback(
    (pick: PlacePick) => setState({ pick, nonce: flyToPoint(pick.ground, PLACE_VIEW_RADIUS_M, 'place') }),
    [flyToPoint],
  )
  const clear = useCallback(() => setState(null), [])
  return { shown: state && flyRequest?.nonce === state.nonce ? state.pick : null, show, clear, lineRef }
}
