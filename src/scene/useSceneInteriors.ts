import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { coveredStationIds, drawnInteriors, hiddenSiblingIds, interiorStationIds, NO_SIBLINGS, type IndexLoad } from '../data/interiorLoad'
import { useViewInteriors } from '../data/useStationInterior'
import { useFocus } from '../lib/focus'
import type { Network } from '../lib/network'
import { deckSpans, deckSpanSets, memberSpans, spanSet, type SpanSet } from '../lib/platformSpan'
import { mergeShown, newPresence, withoutFaded, type Presence } from '../lib/presence'
import { viewInteriorCap } from '../lib/viewStations'
import type { ViewStationSet } from '../lib/viewStationSet'
import { createPresenceStore, type PresenceStore } from './InteriorPresence'
import { interiorLook } from './interiorLook'
import type { InteriorModel } from './interiorModel'

/** A station a drawn interior other than the focused one stands in for: its marker and tie fade by that interior's presence. */
export interface CoveredStation {
  id: string
  presence: Presence
}

export interface SceneInteriors {
  /** Every interior mounted: the drawn ones (the focused one first, at most the cap), then any still fading out. */
  shown: readonly InteriorModel[]
  /** Each shown interior's presence, by file id. */
  presences: ReadonlyMap<string, Presence>
  /** The presences the driver steps, the veil's and their max (Scene's PresenceDriver, ScreenVeil, LiveTrains). */
  store: PresenceStore
  /** PresenceDriver's callback: a leaving interior has faded out. */
  onFaded: (id: string) => void
  /** Their platform spans (each complex's members unioned, never across interiors): the track fades and cars lift there. */
  spans: SpanSet | null
  /** The spans whose trains lift, by deck (deck k of every lifted interior): all but a neighbour of a bare focused station. */
  spansByDeck: readonly (SpanSet | null)[]
  /** The focused interior's covered complex siblings: hidden with the focused marker (none when it isn't drawn). */
  hiddenSiblings: readonly string[]
  /** Every other shown interior's stations, whose markers and ties fade as that interior reveals. */
  covered: readonly CoveredStation[]
  /** hiddenSiblings and the covered stations: ScenePicker's hidden set (a train in reach beats them). */
  hiddenStations: readonly string[]
  /** Every shown interior's stations: their trip marks fade as the interiors reveal (they mark them themselves). */
  markHidden: readonly string[]
  /** Look A's screen veil and the streets' over-veil mode: any interior drawn, and the focused station's own if one is focused. */
  veiled: boolean
}

const subscribeResize = (onChange: () => void): (() => void) => {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}
const capNow = (): number => viewInteriorCap(window.innerWidth, window.innerHeight)

/**
 * The interiors Scene draws (o3r.4): the focused station's, then the loaded ones of the stations in view (`viewSet`,
 * o3r.2's camera-driven store, read with useSyncExternalStore so only a change of set re-renders), at most
 * viewInteriorCap of the window (the canvas fills it). Each joins and leaves with an eased presence (presence.ts): a
 * dropped one stays mounted until it has faded out. Only the focused one gets the trip path, outages, level labels and
 * the camera. With a bare station focused (no interior of its own drawn) no veil is drawn, so its marker, trains and
 * streets keep full contrast, and its neighbours' trains don't lift.
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
  const cap = useSyncExternalStore(subscribeResize, capNow)
  const inView = useViewInteriors(view, focusedId, index, cap)
  const drawn = useMemo(() => drawnInteriors(focused, inView, (id) => network.stationById.has(id), cap), [focused, inView, network, cap])
  const own = focused !== null && drawn[0] === focused ? focused : null

  // The mounted list: `drawn`, then the ones it dropped until PresenceDriver says they faded (adjusted during render).
  const [state, setState] = useState({ drawn, shown: drawn })
  let shown = state.shown
  if (state.drawn !== drawn) {
    shown = mergeShown(state.shown, drawn)
    setState({ drawn, shown })
  }
  const onFaded = useCallback((id: string) => setState((s) => {
    const next = withoutFaded(s.shown, s.drawn, id)
    return next === s.shown ? s : { drawn: s.drawn, shown: next }
  }), [])

  // One presence per file id, created on first show (idempotent) and kept while it is shown.
  const presences = useState(() => new Map<string, Presence>())[0]
  for (const m of shown) if (!presences.has(m.stationId)) presences.set(m.stationId, newPresence(m.stationId))
  const presenceOf = (m: InteriorModel): Presence => presences.get(m.stationId)!
  const store = useState(createPresenceStore)[0]
  const veiled = interiorLook.veil === 'screen' && drawn.length > 0 && (focusedId === null || own !== null)
  useLayoutEffect(() => {
    for (const id of [...presences.keys()]) if (!shown.some((m) => m.stationId === id)) presences.delete(id)
    for (const m of shown) presenceOf(m).target = drawn.includes(m) ? 1 : 0
    store.items = shown.map(presenceOf)
    store.veil.target = veiled ? 1 : 0
  })

  const { spans, spansByDeck } = useMemo(() => {
    const perInterior = shown.map((m) => ({ spans: memberSpans(network.platformSpans, interiorStationIds(m)), presence: presenceOf(m) }))
    // A bare focused station draws no veil: its neighbours' strokes sit over their trains, which stay unlifted.
    const lifts = (m: InteriorModel): boolean => interiorLook.veil !== 'screen' || veiled || m === own
    return {
      spans: spanSet(perInterior),
      spansByDeck: deckSpanSets(
        shown.flatMap((m, i) => (lifts(m) ? [{ decks: deckSpans(perInterior[i]?.spans ?? null, m.trackDecks, m.decks.length), presence: presenceOf(m) }] : [])),
      ),
    }
    // presenceOf reads the stable map; `own` and `veiled` say which lift.
  }, [shown, network, own, veiled])

  // The index says who shares the focused file; the model says who it draws. None when the focused model isn't drawn.
  const hiddenSiblings = useMemo(() => (own ? hiddenSiblingIds(siblings, own) : NO_SIBLINGS), [siblings, own])
  const covered = useMemo(() => {
    const skip = new Set([...hiddenSiblings, ...(focusedId ? [focusedId] : [])])
    const out: CoveredStation[] = []
    for (const m of shown) {
      if (m === own) continue
      for (const id of interiorStationIds(m)) {
        if (skip.has(id)) continue
        skip.add(id)
        out.push({ id, presence: presenceOf(m) })
      }
    }
    return out
  }, [shown, own, hiddenSiblings, focusedId])
  const hiddenStations = useMemo(
    () => (covered.length === 0 ? hiddenSiblings : [...hiddenSiblings, ...covered.map((c) => c.id)]),
    [hiddenSiblings, covered],
  )
  const markHidden = useMemo(() => coveredStationIds(shown), [shown])

  const ids = useRef<string[]>([])
  useEffect(() => {
    ids.current = drawn.map((m) => m.stationId)
  }, [drawn])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = { ...window.__underground, drawnInteriors: () => [...ids.current] }
    return () => {
      if (window.__underground) delete window.__underground.drawnInteriors
    }
  }, [])

  return { shown, presences, store, onFaded, spans, spansByDeck, hiddenSiblings, covered, hiddenStations, markHidden, veiled }
}
