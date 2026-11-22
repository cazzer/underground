import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
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

interface ClockSource {
  offsetS: number
}

/**
 * The router and its timetable loaders are a separate chunk, fetched the first time a trip is planned or the panel
 * opens, so the map's startup bundle never carries them.
 */
const router = () => import('./planTrip')

/**
 * Plans the trip between `ends` while the panel is `open`, leaving now (the live clock once a snapshot has set it,
 * else the device's). A reply that arrives after the ends changed is dropped. A failed or no-service plan is its
 * own state; a failed refresh keeps the journeys already shown. While ready and not `covered` (by a train panel
 * or notice) it replans every REFRESH_MS, silently, and once when the cover goes. Nothing about the ends is
 * stored or sent: only the service's timetable files are fetched.
 */
export function useTripPlan(
  stations: StationsFile,
  ends: TripEnds,
  open: boolean,
  covered: boolean,
  sourceRef: RefObject<ClockSource | null>,
): TripPlan {
  const [state, setState] = useState<TripPlanState>({ status: 'idle' })
  const [showLoading, setShowLoading] = useState(false)
  const [retries, setRetries] = useState(0)
  const requestId = useRef(0)
  const attempt = useRef(0)
  const trigger = useRef<TripTrigger>('ends')
  const { from, to } = ends
  const key = plannable(ends) ? tripKey(ends.from, ends.to) : null
  const nowS = useCallback(() => Math.floor(tripNowS(sourceRef.current, performance.now(), Date.now())), [sourceRef])

  const run = useCallback(
    async (a: string, b: string, why: TripTrigger) => {
      const id = ++requestId.current
      const k = tripKey(a, b)
      const atS = nowS()
      try {
        const m = await router()
        try {
          const { journeys, sameStation } = await m.planTripBetween(stations, a, b, atS)
          if (id !== requestId.current) return
          setState({ status: 'ready', key: k, attempt: attempt.current, trigger: why, atS, journeys: orderJourneys(journeys), sameStation })
        } catch (e) {
          if (id !== requestId.current) return
          if (why === 'tick') {
            console.error('Trip refresh failed', e)
            return
          }
          const settled = { key: k, attempt: attempt.current, trigger: why }
          if (e instanceof m.NoServiceError) setState({ status: 'noService', date: e.date, ...settled })
          else throw e
        }
      } catch (e) {
        if (id !== requestId.current || why === 'tick') return
        console.error('Trip planning failed', e)
        setState({ status: 'error', message: e instanceof Error ? e.message : String(e), key: k, attempt: attempt.current, trigger: why })
      }
    },
    [stations, nowS],
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
