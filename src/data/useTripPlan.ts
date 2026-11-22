import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { orderJourneys, plannable, tripKey, tripNowS, type TripEnds, type TripPlanState, type TripTrigger } from '../lib/tripView'
import type { StationsFile } from './schema'
import { loadRouterTimetable, NoServiceError, planTrip } from './planTrip'

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
 * Plans the trip between `ends` while the panel is `open`, leaving now (the live clock once a snapshot has set it,
 * else the device's). A reply that arrives after the ends changed is dropped. A failed or no-service plan is its
 * own state; a failed refresh keeps the journeys already shown. Replans every REFRESH_MS while ready, silently.
 * Nothing about the ends is stored or sent: only the service's timetable files are fetched.
 */
export function useTripPlan(stations: StationsFile, ends: TripEnds, open: boolean, sourceRef: RefObject<ClockSource | null>): TripPlan {
  const [state, setState] = useState<TripPlanState>({ status: 'idle' })
  const [showLoading, setShowLoading] = useState(false)
  const [retries, setRetries] = useState(0)
  const requestId = useRef(0)
  const attempt = useRef(0)
  const trigger = useRef<TripTrigger>('ends')
  const { from, to } = ends
  const key = plannable(ends) ? tripKey(ends.from, ends.to) : null

  const run = useCallback(
    (a: string, b: string, why: TripTrigger) => {
      const id = ++requestId.current
      const k = tripKey(a, b)
      const atS = Math.floor(tripNowS(sourceRef.current, performance.now(), Date.now()))
      planTrip(stations, [a], [b], atS).then(
        (journeys) => {
          if (id !== requestId.current) return
          setState({ status: 'ready', key: k, attempt: attempt.current, trigger: why, atS, journeys: orderJourneys(journeys) })
        },
        (e: unknown) => {
          if (id !== requestId.current) return
          if (why === 'tick') {
            console.error('Trip refresh failed', e)
            return
          }
          const settled = { key: k, attempt: attempt.current, trigger: why }
          if (e instanceof NoServiceError) setState({ status: 'noService', date: e.date, ...settled })
          else {
            console.error('Trip planning failed', e)
            setState({ status: 'error', message: e instanceof Error ? e.message : String(e), ...settled })
          }
        },
      )
    },
    [stations, sourceRef],
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
    run(from, to, why)
  }, [open, key, from, to, retries, run])

  const ready = state.status === 'ready'
  useEffect(() => {
    if (!open || !ready || from === null || to === null) return
    const timer = setInterval(() => run(from, to, 'tick'), REFRESH_MS)
    return () => clearInterval(timer)
  }, [open, ready, from, to, run])

  useEffect(() => {
    setShowLoading(false)
    if (state.status !== 'loading') return
    const timer = setTimeout(() => setShowLoading(true), LOADING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [state])

  // Opening warms the timetable (a few fetches and a ~25 ms build), after a frame so the panel paints first.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      loadRouterTimetable(stations, Math.floor(tripNowS(sourceRef.current, performance.now(), Date.now()))).catch((e: unknown) =>
        console.warn('Trip timetable warm-up failed', e),
      )
    })
    return () => cancelAnimationFrame(frame)
  }, [open, stations, sourceRef])

  const retry = useCallback(() => {
    trigger.current = 'retry'
    setRetries((n) => n + 1)
  }, [])

  // A plan for other ends (the pair just changed) is not shown.
  const plan: TripPlanState = state.status === 'idle' || (key !== null && state.key === key) ? state : { status: 'idle' }
  return { plan, showLoading, retry }
}
