import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTripPlan } from '../data/useTripPlan'
import type { StationsFile } from '../data/schema'
import type { ArrivalsSource } from './live/arrivals'
import { useTrainSelection } from './trainSelection'
import type { TripEnds, TripPlanState } from './tripView'

export type TripEnd = keyof TripEnds

interface TripValue {
  open: boolean
  ends: TripEnds
  plan: TripPlanState
  showLoading: boolean
  /** Opens or closes the panel. Opening fills only the ends that are still unset from `defaults`. */
  setOpen: (open: boolean, defaults?: TripEnds) => void
  setEnd: (end: TripEnd, stationId: string) => void
  swap: () => void
  retry: () => void
}

interface TripProviderProps {
  stations: StationsFile
  /** The latest live snapshot's clock; null before one arrives (the trip then leaves by the device clock). */
  arrivals: ArrivalsSource | null
  children: ReactNode
}

const TripContext = createContext<TripValue | null>(null)

/**
 * The trip panel's state: whether it is open, its From and To, and the plan for them. Kept in memory for the
 * session (closing the panel keeps the ends); nothing goes to the URL, history or storage.
 */
export function TripProvider({ stations, arrivals, children }: TripProviderProps) {
  const [open, setOpenState] = useState(false)
  const [ends, setEnds] = useState<TripEnds>({ from: null, to: null })
  const sourceRef = useRef(arrivals)
  useEffect(() => {
    sourceRef.current = arrivals
  }, [arrivals])
  // A train panel or the gone notice in front of the trip panel: it stops refreshing until they go.
  const { selectedSummary, notice } = useTrainSelection()
  const { plan, showLoading, retry } = useTripPlan(stations, ends, open, selectedSummary !== null || notice !== null, sourceRef)

  const setOpen = useCallback((next: boolean, defaults?: TripEnds) => {
    setOpenState(next)
    if (!next || !defaults) return
    // Ends already chosen stay; a default never makes the two ends the same station.
    setEnds((e) => {
      const from = e.from ?? (defaults.from !== e.to ? defaults.from : null)
      const to = e.to ?? (defaults.to !== from ? defaults.to : null)
      return from === e.from && to === e.to ? e : { from, to }
    })
  }, [])
  const setEnd = useCallback((end: TripEnd, stationId: string) => setEnds((e) => (e[end] === stationId ? e : { ...e, [end]: stationId })), [])
  const swap = useCallback(() => setEnds((e) => ({ from: e.to, to: e.from })), [])

  const value = useMemo<TripValue>(
    () => ({ open, ends, plan, showLoading, setOpen, setEnd, swap, retry }),
    [open, ends, plan, showLoading, setOpen, setEnd, swap, retry],
  )
  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}

export function useTrip(): TripValue {
  const value = useContext(TripContext)
  if (!value) throw new Error('useTrip must be used inside <TripProvider>')
  return value
}
