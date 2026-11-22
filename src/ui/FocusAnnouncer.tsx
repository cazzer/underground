import { useEffect, useState, type RefObject } from 'react'
import { useFocus } from '../lib/focus'
import { ANNOUNCE_DELAY_MS, focusAnnouncement, shouldAnnounce } from '../lib/focusCause'
import type { Network } from '../lib/network'

interface FocusAnnouncerProps {
  network: Network
  /** A train panel or the gone notice covers the station panel. */
  covered: boolean
  /** The station panel; focus already inside it means its heading is read, so nothing is added. */
  panel: RefObject<HTMLElement | null>
}

/**
 * Tells a screen-reader user, once, that a station panel opened by the camera's auto-focus (zoom, pan, or after a
 * follow ends). Visitor picks are not announced: search moves focus to the heading itself. Polite, name only, and
 * only for a station still focused ANNOUNCE_DELAY_MS after it was entered, so a pass across several stations says
 * just the last one. Never moves focus. One always-mounted live region, so the text change is what is spoken.
 */
export function FocusAnnouncer({ network, covered, panel }: FocusAnnouncerProps) {
  const { focusedId, cause } = useFocus()
  const [text, setText] = useState('')
  useEffect(() => {
    setText('')
    if (!shouldAnnounce({ cause, focusedId, covered, focusInPanel: false })) return
    const timer = setTimeout(() => {
      const station = focusedId ? network.stationById.get(focusedId) : undefined
      const focusInPanel = panel.current?.contains(document.activeElement) ?? false
      if (station && shouldAnnounce({ cause, focusedId, covered, focusInPanel })) setText(focusAnnouncement(station.name))
    }, ANNOUNCE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [focusedId, cause, covered, network, panel])
  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="focus-announcer">
      {text}
    </p>
  )
}
