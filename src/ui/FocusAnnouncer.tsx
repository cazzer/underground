import { useEffect, useRef, useState, type RefObject } from 'react'
import { useFocus } from '../lib/focus'
import { ANNOUNCE_DELAY_MS, focusAnnouncement, shouldAnnounce } from '../lib/focusAnnounce'
import type { Network } from '../lib/network'

interface FocusAnnouncerProps {
  network: Network
  /** A train panel or the gone notice covers the station panel. */
  covered: boolean
  /** The station panel; focus already inside it means its heading is read, so nothing is added. */
  panel: RefObject<HTMLElement | null>
  /** The focused station's "The downtown 1 train skips this station now." (empty when it isn't skipped): said after its name. */
  skipSpoken: string
}

/**
 * Tells a screen-reader user, once, that a station panel opened: by the camera's auto-focus, a map tap, a link or
 * the "Go to" button, none of which move focus. A search pick does, so its heading speaks and this stays silent.
 * Polite, the name (and the skip sentence when the station is skipped now), and only for a station still focused ANNOUNCE_DELAY_MS after it was entered, so a quick pass
 * across several stations says just the last one. Never moves focus. One always-mounted live region, so the text
 * change is what is spoken.
 */
export function FocusAnnouncer({ network, covered, panel, skipSpoken }: FocusAnnouncerProps) {
  const { focusedId } = useFocus()
  const [text, setText] = useState('')
  // Read when the timer fires, so a poll that changes it never restarts the delay.
  const skip = useRef(skipSpoken)
  skip.current = skipSpoken
  useEffect(() => {
    setText('')
    const inPanel = () => panel.current?.contains(document.activeElement) ?? false
    const focusInPanelAtEntry = inPanel()
    if (!shouldAnnounce({ focusedId, covered, focusInPanelAtEntry, focusInPanelNow: false })) return
    const timer = setTimeout(() => {
      const station = focusedId ? network.groupById.get(focusedId) : undefined
      if (station && shouldAnnounce({ focusedId, covered, focusInPanelAtEntry, focusInPanelNow: inPanel() })) setText(focusAnnouncement(station.name, skip.current))
    }, ANNOUNCE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [focusedId, covered, network, panel])
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </p>
  )
}
