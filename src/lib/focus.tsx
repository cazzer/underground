import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { causeAfterCamera, type FocusCause } from './focusCause'
import { nextFocus, type FocusState } from './focusMachine'
import type { Station } from './network'
import type { Ground } from './projection'

/** A camera flight: to a station (focusing it), or to a ground point with `radiusM` in view (drops focus). */
export type FlyRequest =
  | {
      kind: 'station'
      stationId: string
      /** Changes on every request so re-selecting the same station flies again. */
      nonce: number
    }
  | { kind: 'point'; center: Ground; radiusM: number; nonce: number }

interface FocusValue {
  focusedId: string | null
  /** Station the user closed; the camera won't auto-focus it until it moves away. */
  dismissedId: string | null
  /** Who focused the current station: a visitor action ('user') or the camera's auto-focus ('camera'). */
  cause: FocusCause
  flyRequest: FlyRequest | null
  /** Explicit pick (click): focus the station and fly the camera to it. */
  select: (stationId: string) => void
  /**
   * Fly the camera to a ground point showing `radiusM` around it. Drops focus without dismissing it, so
   * the orbit's azimuth springs back to north-up during the flight (the framing assumes north-up).
   */
  flyToPoint: (center: Ground, radiusM: number) => void
  /** User closed the panel: unfocus and remember the station so the camera doesn't refocus it. */
  dismiss: () => void
  /**
   * Re-evaluate focus for the camera's position; no fly. Applied against the latest state, so
   * it can't overwrite a select or dismiss that landed in between.
   */
  updateFromCamera: (distance: number, target: Ground, stations: readonly Station[], settled: boolean) => void
}

interface FocusProviderProps {
  children: ReactNode
}

/** Dev-only console and Playwright hooks; each provider adds and removes only its own. */
export interface UndergroundDevHooks {
  select?: (stationId: string) => void
  selectTrain?: (key: string) => void
  trainKeys?: () => string[]
  /** Viewport px of a live train's dot and, with cars unfolded, its rear and front ends; null if not drawn. */
  trainAt?: (key: string) => { x: number; y: number; rear: { x: number; y: number } | null; front: { x: number; y: number } | null } | null
}

declare global {
  interface Window {
    __underground?: UndergroundDevHooks
  }
}

const FocusContext = createContext<FocusValue | null>(null)

export function FocusProvider({ children }: FocusProviderProps) {
  const [state, setState] = useState<FocusState & { cause: FocusCause }>({ focusedId: null, dismissedId: null, cause: 'user' })
  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null)

  const select = useCallback((stationId: string) => {
    setState({ focusedId: stationId, dismissedId: null, cause: 'user' })
    setFlyRequest((prev) => ({ kind: 'station', stationId, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])
  const flyToPoint = useCallback(
    (center: Ground, radiusM: number) => {
      setState((s) => (s.focusedId === null ? s : { ...s, focusedId: null }))
      setFlyRequest((prev) => ({ kind: 'point', center, radiusM, nonce: (prev?.nonce ?? 0) + 1 }))
    },
    [],
  )
  const dismiss = useCallback(
    () => setState((s) => (s.focusedId === null ? s : { ...s, focusedId: null, dismissedId: s.focusedId })),
    [],
  )
  const updateFromCamera = useCallback(
    (distance: number, target: Ground, stations: readonly Station[], settled: boolean) =>
      setState((prev) => {
        const next = nextFocus({ ...prev, distance, target, stations, settled })
        return next.focusedId === prev.focusedId && next.dismissedId === prev.dismissedId
          ? prev
          : {
              focusedId: next.focusedId,
              dismissedId: next.dismissedId,
              cause: causeAfterCamera(prev.focusedId, next.focusedId, prev.cause),
            }
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

  const { focusedId, dismissedId, cause } = state
  const value = useMemo<FocusValue>(
    () => ({ focusedId, dismissedId, cause, flyRequest, select, flyToPoint, dismiss, updateFromCamera }),
    [focusedId, dismissedId, cause, flyRequest, select, flyToPoint, dismiss, updateFromCamera],
  )
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}

export function useFocus(): FocusValue {
  const value = useContext(FocusContext)
  if (!value) throw new Error('useFocus must be used inside <FocusProvider>')
  return value
}
