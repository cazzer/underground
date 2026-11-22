import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BasemapStats } from '../data/basemapTypes'
import { nextFocus, NO_FOCUS_GROUP, type FocusState } from './focusMachine'
import type { Station } from './network'
import type { Ground } from './projection'
import type { StationGroup } from './stationGroups'
import type { TouchLock } from './touchOrbit'

/** Who asked for a point flight: the location button, or a searched place. A place flight lifts the basemap's location zoom cap. */
export type PointSource = 'locate' | 'place'

/** A camera flight: to a station (focusing it), or to a ground point with `radiusM` in view (drops focus). */
export type FlyRequest =
  | {
      kind: 'station'
      stationId: string
      /** Increases with every request (stations and points share one counter) so re-selecting the same station flies again. */
      nonce: number
    }
  | { kind: 'point'; center: Ground; radiusM: number; source: PointSource; nonce: number }

interface FocusValue {
  focusedId: string | null
  /** Station the user closed; the camera won't auto-focus it until it moves away. */
  dismissedId: string | null
  flyRequest: FlyRequest | null
  /**
   * Explicit pick (click): focus the station and fly the camera to it. A complex is one station, so a member's id
   * focuses (and flies to) its lead: `focusedId` is always a lead.
   */
  select: (stationId: string) => void
  /** Every member of the complex `id` belongs to, the lead first (`[id]` for a lone station); `[]` for null or an unknown id. */
  membersOf: (id: string | null) => readonly string[]
  /**
   * Fly the camera to a ground point showing `radiusM` around it. Drops focus without dismissing it, so
   * the orbit's azimuth springs back to north-up during the flight (the framing assumes north-up). Returns the
   * request's nonce, so a caller can tell whether its flight is still the latest.
   */
  flyToPoint: (center: Ground, radiusM: number, source: PointSource) => number
  /** The camera target on the ground right now, or null before the scene registers one. Read on demand: it never re-renders. */
  viewCenter: () => Ground | null
  /** The scene's camera target getter (ViewCenterSource); null on unmount. */
  setViewCenterSource: (get: (() => Ground) | null) => void
  /** User closed the panel: unfocus and remember the station so the camera doesn't refocus it. */
  dismiss: () => void
  /**
   * Re-evaluate focus for the camera's position; no fly. Applied against the latest state, so
   * it can't overwrite a select or dismiss that landed in between.
   */
  updateFromCamera: (
    distance: number,
    target: Ground,
    stations: readonly Station[],
    settled: boolean,
    focusGroup?: ReadonlySet<string>,
    dismissedGroup?: ReadonlySet<string>,
  ) => void
}

interface FocusProviderProps {
  /** Every station id, a complex member too, to its group (Network.groupById). */
  groups: ReadonlyMap<string, StationGroup>
  children: ReactNode
}

/** The focused station's entrance marks and point in viewport px, the camera's distance and target, the free rect. */
export interface EntranceProbe {
  stationId: string
  distance: number
  target: Ground
  station: { ground: Ground; px: { x: number; y: number } } | null
  marks: { x: number; y: number }[]
  free: { left: number; top: number; right: number; bottom: number }
  viewport: { width: number; height: number }
}

export interface StationPathProbe {
  interiorId: string
  distance: number
  /** The board ends and the centerline, as drawn at the current depth factor. */
  path: { x: number; y: number }[]
  /** The out-of-service machines' ends, the same way. */
  outages: { x: number; y: number }[]
  free: { left: number; top: number; right: number; bottom: number }
}

/** The orbit's controls and two-finger lock (useTouchOrbit), with a ground point's viewport px when one is asked for. */
export interface OrbitProbe {
  azimuth: number
  distance: number
  target: { x: number; z: number }
  lock: TouchLock
  zoomSpeed: number
  rotateSpeed: number
  px: { x: number; y: number } | null
}

/** Dev-only console and Playwright hooks; each provider adds and removes only its own. */
export interface UndergroundDevHooks {
  /** The focused station's street layer probe (useEntranceProbe), while it has a streets file. */
  entrancesAt?: () => EntranceProbe
  /** The priority frame the camera frames (usePathProbe): its path and machine points in viewport px, while there is one. */
  stationPathAt?: () => StationPathProbe
  /** The orbit's state (useTouchOrbit); `at` a ground point to project. */
  orbit?: (at?: { x: number; z: number }) => OrbitProbe
  select?: (stationId: string) => void
  selectTrain?: (key: string) => void
  trainKeys?: () => string[]
  /** Viewport px of a live train's dot and, with cars unfolded, its rear and front ends; null if not drawn. */
  trainAt?: (key: string) => { x: number; y: number; rear: { x: number; y: number } | null; front: { x: number; y: number } | null } | null
  /** TEMPORARY until 2q7.14: aim the trip's drawn exit at scene point (x, z), or clear it with null (useTripExit). */
  exitTo?: (x: number | null, z?: number) => void
  /** The basemap tile store's counters (useBasemapTiles). */
  basemap?: () => BasemapStats
  /** The camera distance the basemap last faded by and, per class, segments drawn, buffer capacity and whether it draws (Basemap.tsx). */
  basemapSegments?: () => { distance: number; classes: Record<string, { used: number; capacity: number; visible: boolean }> }
}

declare global {
  interface Window {
    __underground?: UndergroundDevHooks
  }
}

const FocusContext = createContext<FocusValue | null>(null)
const NO_MEMBERS: readonly string[] = []

export function FocusProvider({ groups, children }: FocusProviderProps) {
  const [state, setState] = useState<FocusState>({ focusedId: null, dismissedId: null })
  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null)

  // One counter for both kinds of flight, so a caller holding a nonce can tell later flights from its own.
  const lastNonce = useRef(0)
  const select = useCallback(
    (picked: string) => {
      const stationId = groups.get(picked)?.id ?? picked
      const nonce = ++lastNonce.current
      setState({ focusedId: stationId, dismissedId: null })
      setFlyRequest({ kind: 'station', stationId, nonce })
    },
    [groups],
  )
  const membersOf = useCallback((id: string | null) => (id === null ? NO_MEMBERS : (groups.get(id)?.memberIds ?? NO_MEMBERS)), [groups])
  const flyToPoint = useCallback((center: Ground, radiusM: number, source: PointSource) => {
    const nonce = ++lastNonce.current
    setState((s) => (s.focusedId === null ? s : { focusedId: null, dismissedId: s.dismissedId }))
    setFlyRequest({ kind: 'point', center, radiusM, source, nonce })
    return nonce
  }, [])
  const viewSource = useRef<(() => Ground) | null>(null)
  const viewCenter = useCallback(() => viewSource.current?.() ?? null, [])
  const setViewCenterSource = useCallback((get: (() => Ground) | null) => {
    viewSource.current = get
  }, [])
  const dismiss = useCallback(
    () => setState((s) => (s.focusedId === null ? s : { focusedId: null, dismissedId: s.focusedId })),
    [],
  )
  const updateFromCamera = useCallback(
    (distance: number, target: Ground, stations: readonly Station[], settled: boolean, focusGroup: ReadonlySet<string> = NO_FOCUS_GROUP, dismissedGroup: ReadonlySet<string> = NO_FOCUS_GROUP) =>
      setState((prev) => {
        const next = nextFocus({ ...prev, distance, target, stations, settled, focusGroup, dismissedGroup })
        return next.focusedId === prev.focusedId && next.dismissedId === prev.dismissedId
          ? prev
          : { focusedId: next.focusedId, dismissedId: next.dismissedId }
      }),
    [],
  )

  // Dev-only screenshot and test tooling: `__underground.select('127')` from the console or Playwright.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = { ...window.__underground, select }
    return () => {
      if (window.__underground) delete window.__underground.select
    }
  }, [select])

  const { focusedId, dismissedId } = state
  const value = useMemo<FocusValue>(
    () => ({ focusedId, dismissedId, flyRequest, select, membersOf, flyToPoint, viewCenter, setViewCenterSource, dismiss, updateFromCamera }),
    [focusedId, dismissedId, flyRequest, select, membersOf, flyToPoint, viewCenter, setViewCenterSource, dismiss, updateFromCamera],
  )
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}

export function useFocus(): FocusValue {
  const value = useContext(FocusContext)
  if (!value) throw new Error('useFocus must be used inside <FocusProvider>')
  return value
}
