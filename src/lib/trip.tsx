import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTripPlan } from '../data/useTripPlan'
import type { StationsFile } from '../data/schema'
import type { ArrivalsSource } from './live/arrivals'
import { useTrainSelection } from './trainSelection'
import type { TripEnds, TripPlanState } from './tripView'

export type TripEnd = keyof TripEnds

/** The place an end was picked from, per end: "120 Broadway" beside its nearest station. A note, not a point: planning reads `ends` only. */
export interface TripPlaces {
  from: string | null
  to: string | null
}

interface TripValue {
  open: boolean
  ends: TripEnds
  places: TripPlaces
  plan: TripPlanState
  showLoading: boolean
  /** Opens or closes the panel; `start` opens it on new ends. */
  setOpen: (open: boolean) => void
  /** Sets both ends and their notes and opens the panel (a directions pick, `directionsTrip`). Equal ends keep the state's identity, so nothing replans. */
  start: (ends: TripEnds, places: TripPlaces) => void
  /** Sets an end to a station; `place` names the searched place it is the nearest station to (any station pick clears it). */
  setEnd: (end: TripEnd, stationId: string, place?: string | null) => void
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
  const [places, setPlaces] = useState<TripPlaces>({ from: null, to: null })
  const sourceRef = useRef(arrivals)
  useEffect(() => {
    sourceRef.current = arrivals
  }, [arrivals])
  // A train panel or the gone notice in front of the trip panel: it stops refreshing until they go.
  const { selectedSummary, notice } = useTrainSelection()
  const { plan, showLoading, retry } = useTripPlan(stations, ends, open, selectedSummary !== null || notice !== null, sourceRef, arrivals?.snapshot ?? null)

  const setOpen = useCallback((next: boolean) => setOpenState(next), [])
  const start = useCallback((next: TripEnds, notes: TripPlaces) => {
    setEnds((e) => (e.from === next.from && e.to === next.to ? e : next))
    setPlaces((p) => (p.from === notes.from && p.to === notes.to ? p : notes))
    setOpenState(true)
  }, [])
  const setEnd = useCallback((end: TripEnd, stationId: string, place: string | null = null) => {
    setEnds((e) => (e[end] === stationId ? e : { ...e, [end]: stationId }))
    setPlaces((p) => (p[end] === place ? p : { ...p, [end]: place }))
  }, [])
  const swap = useCallback(() => {
    setEnds((e) => ({ from: e.to, to: e.from }))
    setPlaces((p) => ({ from: p.to, to: p.from }))
  }, [])

  const value = useMemo<TripValue>(
    () => ({ open, ends, places, plan, showLoading, setOpen, start, setEnd, swap, retry }),
    [open, ends, places, plan, showLoading, setOpen, start, setEnd, swap, retry],
  )
  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}

export function useTrip(): TripValue {
  const value = useContext(TripContext)
  if (!value) throw new Error('useTrip must be used inside <TripProvider>')
  return value
}
