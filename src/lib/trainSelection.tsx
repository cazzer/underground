import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import type { LiveLayer } from '../data/useLive'
import { useFocus } from './focus'
import { initialTrainSelection, trainSelectionReducer } from './live/trainSelection'
import { goneNotice, trainSummary, type TrainSummary } from './live/trainSummary'
import type { Network } from './network'
import type { LiveTrip } from './realtime/prepareTrips'

/** How long the "no longer tracked" notice stays in the panel slot. */
const NOTICE_MS = 10_000

interface TrainSelectionValue {
  selectedKey: string | null
  /** The selected trip as of the latest poll it was in (kept through a one-poll miss); null if never seen. */
  selectedTrip: LiveTrip | null
  selectedSummary: TrainSummary | null
  /** Counts explicit selections: the train panel takes focus each time it changes. */
  selections: number
  /** Set for a while after a selected train drops out of the feed. */
  notice: string | null
  dismissNotice: () => void
  /** Explicit pick. The station focus (and its interior) stays; the train panel shows over the station's. */
  selectTrain: (key: string) => void
  /** User closed the train panel. */
  clearTrain: () => void
}

interface TrainSelectionProviderProps {
  /** This poll's placed trips; null while there is no live layer. */
  layer: LiveLayer | null
  network: Network
  children: ReactNode
}

const TrainSelectionContext = createContext<TrainSelectionValue | null>(null)

const reducer = trainSelectionReducer<LiveTrip, TrainSummary>
const initial = initialTrainSelection<LiveTrip, TrainSummary>

/** The selected live train, keyed by trip key so it survives polls. Inside FocusProvider: picking a station clears it. */
export function TrainSelectionProvider({ layer, network, children }: TrainSelectionProviderProps) {
  const [state, dispatch] = useReducer(reducer, undefined, initial)
  const { flyRequest } = useFocus()
  const trips = layer?.trips ?? null
  const patterns = layer?.patterns
  // Summaries are taken whenever the trip is seen, so the notice still names it once the layer is gone.
  const summarize = useCallback(
    (trip: LiveTrip) => trainSummary(trip, network.routeById, patterns ?? {}, (id) => network.stationById.get(id)?.name),
    [network, patterns],
  )

  useEffect(() => dispatch({ type: 'observe', trips, summarize }), [trips, summarize])

  // An explicit station pick (each one is a new station fly request) replaces the train, without a notice.
  // A point flight (the location button) leaves it selected.
  const lastFly = useRef(flyRequest)
  useEffect(() => {
    if (flyRequest === lastFly.current) return
    lastFly.current = flyRequest
    if (flyRequest?.kind === 'station') dispatch({ type: 'clear' })
  }, [flyRequest])

  useEffect(() => {
    if (!state.notice) return
    const timer = setTimeout(() => dispatch({ type: 'dismissNotice' }), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [state.notice])

  const selectTrain = useCallback((key: string) => dispatch({ type: 'select', key, summarize }), [summarize])
  const clearTrain = useCallback(() => dispatch({ type: 'clear' }), [])
  const dismissNotice = useCallback(() => dispatch({ type: 'dismissNotice' }), [])

  // Dev-only test tooling: `__underground.selectTrain(key)` and `trainKeys()`; the scene adds `trainAt`.
  const latestTrips = useRef(trips)
  useEffect(() => {
    latestTrips.current = trips
  }, [trips])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = {
      ...window.__underground,
      selectTrain,
      trainKeys: () => (latestTrips.current ?? []).map((t) => t.key),
    }
    return () => {
      const hooks = window.__underground
      if (!hooks) return
      delete hooks.selectTrain
      delete hooks.trainKeys
    }
  }, [selectTrain])

  const selected = state.key !== null
  const selectedTrip = selected ? state.lastTrip : null
  const selectedSummary = selected ? state.lastSummary : null
  const notice = state.notice ? goneNotice(state.notice.summary) : null
  const value = useMemo<TrainSelectionValue>(
    () => ({
      selectedKey: state.key,
      selectedTrip,
      selectedSummary,
      selections: state.selections,
      notice,
      dismissNotice,
      selectTrain,
      clearTrain,
    }),
    [state.key, selectedTrip, selectedSummary, state.selections, notice, dismissNotice, selectTrain, clearTrain],
  )
  return <TrainSelectionContext.Provider value={value}>{children}</TrainSelectionContext.Provider>
}

export function useTrainSelection(): TrainSelectionValue {
  const value = useContext(TrainSelectionContext)
  if (!value) throw new Error('useTrainSelection must be used inside <TrainSelectionProvider>')
  return value
}
