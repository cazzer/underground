import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocus } from '../lib/focus'
import type { Network } from '../lib/network'
import { parseStationHash, stationHashUrl } from '../lib/stationHash'

export interface StationHash {
  /** The hash named a station that doesn't exist; it has been cleared. */
  linkNotice: boolean
  dismissLinkNotice: () => void
}

function replaceHash(id: string | null): void {
  history.replaceState(history.state, '', stationHashUrl(location, id))
}

/**
 * Keeps `#station=<id>` and the focused station in step, without adding history entries. Reads the hash
 * on mount and on `hashchange` (an unknown id raises `linkNotice` and clears the hash); writes it whenever
 * focus changes, including zoom-driven focus. Call it as a passive effect, after the HUD has measured.
 */
export function useStationHash(network: Network): StationHash {
  const { focusedId, select } = useFocus()
  const [linkNotice, setLinkNotice] = useState(false)
  const focused = useRef(focusedId)
  // What the hash was last written for; a mount with a hash to read must not clear it first.
  const written = useRef<string | null>(null)

  useEffect(() => {
    focused.current = focusedId
  }, [focusedId])

  useEffect(() => {
    const read = () => {
      const raw = parseStationHash(location.hash)
      if (raw === null) return
      const station = network.stationById.get(raw) ?? network.stationById.get(raw.toUpperCase())
      if (!station) {
        setLinkNotice(true)
        // Keep the URL true to what is on screen: the focused station's hash, or none.
        replaceHash(focused.current)
        return
      }
      // A complex is one station: any member's link opens its lead (the write below then rewrites the hash to it).
      const id = network.groupById.get(station.id)?.id ?? station.id
      if (focused.current !== id) select(id)
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [network, select])

  useEffect(() => {
    if (focusedId) setLinkNotice(false)
    if (focusedId === written.current) return
    written.current = focusedId
    replaceHash(focusedId)
  }, [focusedId])

  const dismissLinkNotice = useCallback(() => setLinkNotice(false), [])
  return { linkNotice, dismissLinkNotice }
}
