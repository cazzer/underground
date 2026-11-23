import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { coveredStationIds, drawnInteriors, hiddenSiblingIds, interiorStationIds, type IndexLoad } from '../data/interiorLoad'
import { useViewInteriors } from '../data/useStationInterior'
import { useFocus } from '../lib/focus'
import type { Network } from '../lib/network'
import { deckSpans, deckSpanSets, memberSpans, spanSet, type SpanSet } from '../lib/platformSpan'
import type { ViewStationSet } from '../lib/viewStationSet'
import { interiorLook } from './interiorLook'
import type { InteriorModel } from './interiorModel'

export interface SceneInteriors {
  /** Every interior drawn, the focused one first, at most MAX_VIEW_INTERIORS. */
  drawn: readonly InteriorModel[]
  /** Their platform spans (each complex's members unioned, never across interiors): the track fades and cars lift there. */
  spans: SpanSet | null
  /** The same spans by deck (deck k of every drawn interior), so each deck's trains draw between its strokes and the next band's. */
  spansByDeck: readonly (SpanSet | null)[]
  /** Stations whose marker and tie hide beside the focused one's: its covered complex siblings and every other drawn interior's stations. */
  hiddenStations: readonly string[]
  /** The focused interior's covered complex siblings only: ScenePicker treats them as open with the focused station. */
  hiddenSiblings: readonly string[]
  /** Every drawn interior's stations: their trip marks fade as the interiors reveal (they mark them themselves). */
  markHidden: readonly string[]
  /** Look A's one screen veil is up: any interior is drawn. */
  veiled: boolean
}

/**
 * The interiors Scene draws (o3r.4): the focused station's, then the loaded ones of the stations in view (`viewSet`,
 * o3r.2's camera-driven store, read with useSyncExternalStore so only a change of set re-renders), and what the other
 * layers need from them. Only the focused one gets the trip path, outages and the camera; the rest draw alone.
 */
export function useSceneInteriors(
  network: Network,
  focused: InteriorModel | null,
  viewSet: ViewStationSet,
  index: IndexLoad,
  siblings: readonly string[],
): SceneInteriors {
  const { focusedId } = useFocus()
  const view = useSyncExternalStore(viewSet.subscribe, viewSet.get)
  const inView = useViewInteriors(view, focusedId, index)
  const drawn = useMemo(() => drawnInteriors(focused, inView, (id) => network.stationById.has(id)), [focused, inView, network])
  const { spans, spansByDeck } = useMemo(() => {
    const perInterior = drawn.map((m) => memberSpans(network.platformSpans, interiorStationIds(m)))
    return {
      spans: spanSet(perInterior),
      spansByDeck: deckSpanSets(drawn.map((m, i) => deckSpans(perInterior[i]!, m.trackDecks, m.decks.length))),
    }
  }, [drawn, network])
  // The index says who shares the focused file; the model says who it draws. Their markers and ties go with the focused one's.
  const hiddenSiblings = useMemo(() => hiddenSiblingIds(siblings, focused), [siblings, focused])
  const others = useMemo(() => coveredStationIds(drawn.filter((m) => m !== focused)), [drawn, focused])
  const hiddenStations = useMemo(
    () => (others.length === 0 ? hiddenSiblings : [...new Set([...hiddenSiblings, ...others])]),
    [hiddenSiblings, others],
  )
  const markHidden = useMemo(() => coveredStationIds(drawn), [drawn])
  const veiled = interiorLook.veil === 'screen' && drawn.length > 0

  const ids = useRef<string[]>([])
  ids.current = drawn.map((m) => m.stationId)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = { ...window.__underground, drawnInteriors: () => [...ids.current] }
    return () => {
      if (window.__underground) delete window.__underground.drawnInteriors
    }
  }, [])

  return { drawn, spans, spansByDeck, hiddenStations, hiddenSiblings, markHidden, veiled }
}
