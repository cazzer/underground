import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { RealtimeSnapshot } from './realtime'
import type { TripLookup } from '../lib/realtime/tripLookup'
import { orderJourneys, plannable, tripKey, tripNowS, type TripEnds, type TripPlanState, type TripTrigger } from '../lib/tripView'
import type { StationsFile } from './schema'

/** How long a plan runs before "Finding trips…" shows, so a quick one never flashes it. */
export const LOADING_DELAY_MS = 250
/** The open panel replans this often so departure times and "in N min" stay true. */
export const REFRESH_MS = 30_000

export interface TripPlan {
  plan: TripPlanState
  /** The plan has been running past LOADING_DELAY_MS. */
  showLoading: boolean
  retry: () => void
}

/** The live clock and the data the overlay reads: an `ArrivalsSource` is one. */
interface LiveSource {
  offsetS: number
  snapshot: RealtimeSnapshot
  lookup: TripLookup
}

/**
 * The router and its timetable loaders are a separate chunk, fetched the first time a trip is planned or the panel
 * opens, so the map's startup bundle never carries them.
 */
const router = () => import('./planTrip')

/**
 * Plans the trip between `ends` while the panel is `open`, leaving now (the live clock once a snapshot has set it,
 * else the device's), on the schedule with the next 30 minutes from the latest snapshot. A reply that arrives after the ends changed is dropped. A failed or no-service plan is its
 * own state; a failed refresh keeps the journeys already shown. While ready and not `covered` (by a train panel
 * or notice) it replans every REFRESH_MS and whenever `snapshot` is newer than the one planned on, silently, and
 * once when the cover goes. Nothing about the ends is
 * stored or sent: only the service's timetable files are fetched.
 */
export function useTripPlan(
  stations: StationsFile,
  ends: TripEnds,
  open: boolean,
  covered: boolean,
  sourceRef: RefObject<LiveSource | null>,
  snapshot: RealtimeSnapshot | null,
): TripPlan {
  const [state, setState] = useState<TripPlanState>({ status: 'idle' })
  const [showLoading, setShowLoading] = useState(false)
  const [retries, setRetries] = useState(0)
  const requestId = useRef(0)
  const attempt = useRef(0)
  const planned = useRef<RealtimeSnapshot | null>(null)
  const trigger = useRef<TripTrigger>('ends')
  const { from, to } = ends
  const key = plannable(ends) ? tripKey(ends.from, ends.to) : null
  const nowS = useCallback(() => Math.floor(tripNowS(sourceRef.current, performance.now(), Date.now())), [sourceRef])

  const run = useCallback(
    async (a: string, b: string, why: TripTrigger) => {
      const id = ++requestId.current
      const k = tripKey(a, b)
      const atS = nowS()
      // The device clock may trail the live one, so the overlay is used only on a snapshot's own clock.
      const src = sourceRef.current
      planned.current = src?.snapshot ?? null
      try {
        const m = await router()
        try {
          const { journeys, sameStation, overlay } = await m.planTripBetween(stations, a, b, atS, src ? { snapshot: src.snapshot, lookup: src.lookup } : null)
          if (id !== requestId.current) return
          setState({ status: 'ready', key: k, attempt: attempt.current, trigger: why, atS, journeys: orderJourneys(journeys), sameStation, overlay })
        } catch (e) {
          if (id !== requestId.current) return
          if (why === 'tick' || why === 'poll') {
            console.error('Trip refresh failed', e)
            return
          }
          const settled = { key: k, attempt: attempt.current, trigger: why }
          if (e instanceof m.NoServiceError) setState({ status: 'noService', date: e.date, ...settled })
          else throw e
        }
      } catch (e) {
        if (id !== requestId.current) return
        console.error(why === 'tick' || why === 'poll' ? 'Trip refresh failed' : 'Trip planning failed', e)
        if (why === 'tick' || why === 'poll') return
        setState({ status: 'error', message: e instanceof Error ? e.message : String(e), key: k, attempt: attempt.current, trigger: why })
      }
    },
    [stations, nowS, sourceRef],
  )

  // A new pair, a retry or opening the panel: a fresh run the visitor will hear about.
  useEffect(() => {
    if (!open || key === null || from === null || to === null) {
      requestId.current++
      setState({ status: 'idle' })
      return
    }
    attempt.current++
    const why = trigger.current
    trigger.current = 'ends'
    setState({ status: 'loading', key })
    void run(from, to, why)
  }, [open, key, from, to, retries, run])

  // Refresh while the panel is in front. When a train panel or notice goes, the times may be old: replan at once.
  const ready = state.status === 'ready'
  const wasCovered = useRef(covered)
  useEffect(() => {
    const uncovered = wasCovered.current && !covered
    wasCovered.current = covered
    if (!open || !ready || covered || from === null || to === null) return
    if (uncovered) void run(from, to, 'tick')
    const timer = setInterval(() => void run(from, to, 'tick'), REFRESH_MS)
    return () => clearInterval(timer)
  }, [open, ready, covered, from, to, run])

  // A snapshot newer than the one the shown plan used: replan on it. Runs again when a plan settles or the
  // cover goes, so a snapshot that came meanwhile is not missed.
  useEffect(() => {
    if (!open || !ready || covered || from === null || to === null || snapshot === null || snapshot === planned.current) return
    void run(from, to, 'poll')
  }, [open, ready, covered, from, to, run, snapshot])

  useEffect(() => {
    setShowLoading(false)
    if (state.status !== 'loading') return
    const timer = setTimeout(() => setShowLoading(true), LOADING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [state])

  // Opening warms the router and its timetable (a few fetches and a ~25 ms build), after a frame so the panel paints first.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      router()
        .then((m) => m.loadRouterTimetable(stations, nowS()))
        .catch((e: unknown) => console.warn('Trip timetable warm-up failed', e))
    })
    return () => cancelAnimationFrame(frame)
  }, [open, stations, nowS])

  const retry = useCallback(() => {
    trigger.current = 'retry'
    setRetries((n) => n + 1)
  }, [])

  // A plan for other ends (the pair just changed) is not shown.
  const plan: TripPlanState = state.status === 'idle' || (key !== null && state.key === key) ? state : { status: 'idle' }
  return { plan, showLoading, retry }
}
