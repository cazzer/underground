import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { usePanelCollapse, usePanelCollapseControls } from '../lib/panelCollapse'
import { useTrainSelection } from '../lib/trainSelection'

interface ChangesPanelArgs {
  /** The bottom slot's panel element (the list's while it is in front): focus returns on close only from inside it. */
  panel: RefObject<HTMLElement | null>
  /** The header chip: where focus goes when the list closes, while the chip is still there. */
  chipRef: RefObject<HTMLElement | null>
  /** Where focus goes when the chip is gone: the trip panel's heading, else the station's, else the Search button. */
  tripHeading: RefObject<HTMLElement | null>
  stationHeading: RefObject<HTMLElement | null>
  searchButton: RefObject<HTMLElement | null>
}

export interface ChangesPanelControls {
  /** The list is open, though a train panel or notice may be in front of it. */
  changesOpen: boolean
  /** The list's heading, or its bar while collapsed. */
  headingRef: RefObject<HTMLElement | null>
  /** The header chip: opens the list (a train panel or notice in front is cleared, focus goes to the heading), or closes it when it is in front. */
  toggleChanges: () => void
  /** "Close", or Esc: closes it and, when focus was inside, hands it to the chip, else the panel underneath. */
  closeChanges: () => void
}

/**
 * The service changes list's open and close with the focus rules, like the trip panel's (`useTripPanel`). The chip is
 * a deliberate request, so it covers the trip and station panels; a train pick covers it again. Nothing here moves the
 * camera.
 */
export function useChangesPanel({ panel, chipRef, tripHeading, stationHeading, searchButton }: ChangesPanelArgs): ChangesPanelControls {
  const { changesOpen, openChanges, closeChanges: close } = usePanelCollapseControls()
  const { front } = usePanelCollapse()
  const { selectedSummary, notice, clearTrain, dismissNotice } = useTrainSelection()
  const headingRef = useRef<HTMLElement>(null)
  const [focusRequests, setFocusRequests] = useState(0)

  // One frame later the panel is mounted and shown (it may have been under a train panel a moment ago).
  useEffect(() => {
    if (focusRequests === 0) return
    const frame = requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [focusRequests])

  const toggleChanges = useCallback(() => {
    if (front === 'changes') {
      close()
      return
    }
    if (selectedSummary !== null) clearTrain()
    if (notice !== null) dismissNotice()
    openChanges()
    setFocusRequests((n) => n + 1)
  }, [front, close, selectedSummary, notice, clearTrain, dismissNotice, openChanges])

  const closeChanges = useCallback(() => {
    const hadFocus = panel.current?.contains(document.activeElement) ?? false
    close()
    if (hadFocus) {
      requestAnimationFrame(() => (chipRef.current ?? tripHeading.current ?? stationHeading.current ?? searchButton.current)?.focus({ preventScroll: true }))
    }
  }, [panel, close, chipRef, tripHeading, stationHeading, searchButton])

  return { changesOpen, headingRef, toggleChanges, closeChanges }
}
