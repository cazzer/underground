import { useCallback, type RefObject } from 'react'
import type { LocateControls } from '../data/useLocate'
import { useFocus } from '../lib/focus'
import { markedPlacement } from '../lib/locate'
import { useTrainSelection } from '../lib/trainSelection'
import { useTrip } from '../lib/trip'
import { defaultEnds } from '../lib/tripView'

interface TripPanelArgs {
  locate: LocateControls
  /** The bottom panel's element (the trip panel's when it is in front): × and Esc move focus only from inside it. */
  panel: RefObject<HTMLElement | null>
  /** The station panel's heading: where focus goes when the trip panel closes over an open station. */
  stationHeading: RefObject<HTMLElement | null>
  tripButton: RefObject<HTMLElement | null>
}

export interface TripPanelControls {
  /** The panel is open, though a train panel or notice may be in front of it. */
  tripOpen: boolean
  /** The panel is open and nothing covers it: what the header button reports as expanded. */
  tripShown: boolean
  /**
   * The header button. Closed: opens the panel, first closing a train panel or notice in front, so what the button
   * says is what is on screen. Open but covered: brings it to the front the same way. Shown: closes it.
   */
  toggleTrip: () => void
  /** The panel's × and Esc. */
  closeTrip: () => void
}

/**
 * Opening and closing the trip panel with the focus rules: the button toggles and keeps focus; × and Esc remove
 * the focused element, so when focus was inside the panel, one frame later (a station panel underneath has
 * mounted by then) it goes to the station heading, else back to the button that opened the panel.
 */
export function useTripPanel({ locate, panel, stationHeading, tripButton }: TripPanelArgs): TripPanelControls {
  const { open, setOpen } = useTrip()
  const { focusedId } = useFocus()
  const { selectedSummary, notice, clearTrain, dismissNotice } = useTrainSelection()
  const covered = selectedSummary !== null || notice !== null
  const placement = markedPlacement(locate.state)
  const toggleTrip = useCallback(() => {
    // A tap doesn't focus a button on iOS; the panel's heading and the later focus return both start from here.
    tripButton.current?.focus({ preventScroll: true })
    if (open && !covered) {
      setOpen(false)
      return
    }
    if (selectedSummary !== null) clearTrain()
    if (notice !== null) dismissNotice()
    setOpen(true, open ? undefined : defaultEnds(focusedId, placement))
  }, [open, covered, selectedSummary, notice, clearTrain, dismissNotice, setOpen, focusedId, placement, tripButton])
  const closeTrip = useCallback(() => {
    const hadFocus = panel.current?.contains(document.activeElement) ?? false
    setOpen(false)
    if (hadFocus) requestAnimationFrame(() => (stationHeading.current ?? tripButton.current)?.focus({ preventScroll: true }))
  }, [setOpen, panel, stationHeading, tripButton])
  return { tripOpen: open, tripShown: open && !covered, toggleTrip, closeTrip }
}
