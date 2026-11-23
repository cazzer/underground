import { useEffect } from 'react'
import type { FrontPanel } from '../lib/panelCollapseState'

interface PanelEscape {
  /** The panel in front (`usePanelCollapse().front`): Esc closes it, one level a press. */
  front: FrontPanel
  /** While search is open, Esc belongs to it: one press must not also dismiss a panel. */
  searchOpen: boolean
  closeTrain: () => void
  closeNotice: () => void
  closeChanges: () => void
  /** The trip panel's Esc: an active step ends first, then an opened journey goes back to the list, then it closes. */
  escapeTrip: () => void
  closeStation: () => void
}

/** Esc closes the front panel: the train panel, then the notice, then the service changes list, then the trip panel, then the station's. */
export function usePanelEscape({ front, searchOpen, closeTrain, closeNotice, closeChanges, escapeTrip, closeStation }: PanelEscape): void {
  useEffect(() => {
    if (front === null || searchOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      // A modal dialog (a trip search, even with focus on the body) owns Esc: its own close is the press.
      if (e.key !== 'Escape' || document.querySelector('dialog:modal')) return
      if (front === 'train') closeTrain()
      else if (front === 'notice') closeNotice()
      else if (front === 'changes') closeChanges()
      else if (front === 'trip') escapeTrip()
      else closeStation()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [front, searchOpen, closeStation, closeTrain, closeNotice, closeChanges, escapeTrip])
}
