import { useCallback, type RefObject } from 'react'
import type { LocateControls } from '../data/useLocate'
import { useFocus } from '../lib/focus'
import { markedPlacement } from '../lib/locate'
import { useTrip } from '../lib/trip'
import { defaultEnds } from '../lib/tripView'

interface TripPanelArgs {
  locate: LocateControls
  /** The station panel's heading: where focus goes when the trip panel closes over an open station. */
  stationHeading: RefObject<HTMLElement | null>
  tripButton: RefObject<HTMLElement | null>
}

export interface TripPanelControls {
  tripOpen: boolean
  /** The header button: opens (filling unset ends from the focused station and the marked fix) or closes. */
  toggleTrip: () => void
  /** The panel's × and Esc. */
  closeTrip: () => void
}

/**
 * Opening and closing the trip panel with the focus rules: the button toggles and keeps focus; × and Esc remove
 * the focused element, so one frame later (a station panel underneath has mounted by then) focus goes to the
 * station heading, else back to the button that opened the panel.
 */
export function useTripPanel({ locate, stationHeading, tripButton }: TripPanelArgs): TripPanelControls {
  const { open, setOpen } = useTrip()
  const { focusedId } = useFocus()
  const placement = markedPlacement(locate.state)
  const toggleTrip = useCallback(() => {
    // A tap doesn't focus a button on iOS; the panel's heading and the later focus return both start from here.
    tripButton.current?.focus({ preventScroll: true })
    setOpen(!open, open ? undefined : defaultEnds(focusedId, placement))
  }, [open, setOpen, focusedId, placement, tripButton])
  const closeTrip = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => (stationHeading.current ?? tripButton.current)?.focus({ preventScroll: true }))
  }, [setOpen, stationHeading, tripButton])
  return { tripOpen: open, toggleTrip, closeTrip }
}
