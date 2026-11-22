import { useCallback, useState } from 'react'
import { lineOf, NO_FILTER, toggledFilter, type LineFilterState } from '../lib/live/lineFilter'

export interface LineFilterControl {
  /** The chosen line (`lineKey`), or null for every line. */
  line: string | null
  /** Chooses a line, or clears the filter when it is already the chosen one. */
  toggle: (key: string) => void
}

/**
 * The station panel's line filter. It lives in the HUD, above the panel, so a train panel covering the station
 * panel and returning keeps it. Only a tap (`toggle`) or a station change ends it, and nothing else: not arrivals
 * coming and going. It reads as unset at any other station, and the stale choice is dropped on the first render
 * there, so coming back to a station never restores it.
 */
export function useLineFilter(stationId: string | null): LineFilterControl {
  const [state, setState] = useState<LineFilterState>(NO_FILTER)
  const line = lineOf(state, stationId)
  if (state.line !== null && line === null) setState(NO_FILTER)
  const toggle = useCallback((key: string) => {
    if (stationId !== null) setState((s) => toggledFilter(s, stationId, key))
  }, [stationId])
  return { line, toggle }
}
