import { useCallback, useState, type RefObject } from 'react'
import type { LocateControls } from '../data/useLocate'
import { useFocus } from '../lib/focus'
import { markedPlacement } from '../lib/locate'
import { usePanelCollapseControls } from '../lib/panelCollapse'
import { useTrainSelection } from '../lib/trainSelection'
import { useTrip, type TripEnd } from '../lib/trip'
import { directionsTrip, type DirectionsTarget } from '../lib/tripDirections'

interface TripPanelArgs {
  locate: LocateControls
  /** The bottom panel's element (the trip panel's when it is in front): Esc moves focus only from inside it. */
  panel: RefObject<HTMLElement | null>
  /** The station panel's heading: where focus goes when the trip panel closes over an open station. */
  stationHeading: RefObject<HTMLElement | null>
  /** Where focus goes when the trip panel closes with no station panel under it. */
  searchButton: RefObject<HTMLElement | null>
  /** Any station's complex siblings (its group's other members): a directions pick never fills the other end from the target's complex. */
  siblingsOf: (stationId: string) => readonly string[]
}

/** The latest directions pick's focus target for the trip panel: its heading, or the row of the end left empty. `n` makes each pick a new request. */
export interface TripFocusRequest {
  target: 'heading' | TripEnd
  n: number
}

export interface TripPanelControls {
  /** The panel is open, though a train panel or notice may be in front of it. */
  tripOpen: boolean
  /**
   * A directions pick (a search row's From or To, the station panel's): closes a train panel or notice in front,
   * expands a collapsed trip panel, sets the ends by `directionsTrip` and asks the panel to focus the end left
   * empty, else its heading.
   */
  openTrip: (end: TripEnd, target: DirectionsTarget) => void
  /** "Close trip". */
  closeTrip: () => void
  /** Esc: end the active step, else back from an opened journey to the list when there is one (a bar skips both), else `closeTrip`. */
  escapeTrip: () => void
  focusRequest: TripFocusRequest | null
}

/**
 * Opening and closing the trip panel with the focus rules. A directions pick opens it and hands focus to the panel
 * (`focusRequest`, read by `TripPanel`); closing removes the focused element, so when focus was inside the panel,
 * one frame later (a station panel underneath has mounted by then) it goes to the station heading, else to Search.
 */
export function useTripPanel({ locate, panel, stationHeading, searchButton, siblingsOf }: TripPanelArgs): TripPanelControls {
  const { open, ends, places, setOpen, start, selection, backToList, activeStep, endStep } = useTrip()
  const { focusedId } = useFocus()
  const { selectedSummary, notice, clearTrain, dismissNotice } = useTrainSelection()
  const { tripRequested, tripCollapsed } = usePanelCollapseControls()
  const [focusRequest, setFocusRequest] = useState<TripFocusRequest | null>(null)
  const fix = markedPlacement(locate.state)
  const openTrip = useCallback(
    (end: TripEnd, target: DirectionsTarget) => {
      const next = directionsTrip({ end, target, current: ends, currentPlaces: places, focusedId, siblingsOf, fix })
      if (selectedSummary !== null) clearTrain()
      if (notice !== null) dismissNotice()
      tripRequested()
      start(next.ends, next.places)
      setFocusRequest((r) => ({ target: next.empty ?? 'heading', n: (r?.n ?? 0) + 1 }))
    },
    [ends, places, focusedId, siblingsOf, fix, selectedSummary, notice, clearTrain, dismissNotice, tripRequested, start],
  )
  const closeTrip = useCallback(() => {
    const hadFocus = panel.current?.contains(document.activeElement) ?? false
    setOpen(false)
    if (hadFocus) requestAnimationFrame(() => (stationHeading.current ?? searchButton.current)?.focus({ preventScroll: true }))
  }, [setOpen, panel, stationHeading, searchButton])
  // A collapsed panel is a bar with its body hidden: Esc closes it, not an unseen step or Back. Otherwise one level per
  // press: the active step ends (its station is dismissed, the camera stays, focus goes to the step's button), then Back
  // from the opened journey, then close.
  const escapeTrip = useCallback(() => {
    if (tripCollapsed) closeTrip()
    else if (activeStep !== null) {
      const hadFocus = panel.current?.contains(document.activeElement) ?? false
      endStep()
      if (hadFocus) {
        requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(`[data-step="${activeStep}"]`)?.focus({ preventScroll: true }))
      }
    } else if (selection.canGoBack) backToList()
    else closeTrip()
  }, [selection.canGoBack, tripCollapsed, activeStep, endStep, panel, backToList, closeTrip])
  return { tripOpen: open, openTrip, closeTrip, escapeTrip, focusRequest }
}
