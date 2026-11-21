import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { nextFocus, type FocusState } from './focusMachine'
import type { Station } from './network'
import type { Ground } from './projection'

export interface FlyRequest {
  stationId: string
  /** Changes on every request so re-selecting the same station flies again. */
  nonce: number
}

interface FocusValue {
  focusedId: string | null
  /** Station the user closed; the camera won't auto-focus it until it moves away. */
  dismissedId: string | null
  flyRequest: FlyRequest | null
  /** Explicit pick (click): focus the station and fly the camera to it. */
  select: (stationId: string) => void
  /** User closed the panel: unfocus and remember the station so the camera doesn't refocus it. */
  dismiss: () => void
  /**
   * Re-evaluate focus for the camera's position; no fly. Applied against the latest state, so
   * it can't overwrite a select or dismiss that landed in between.
   */
  updateFromCamera: (distance: number, target: Ground, stations: readonly Station[]) => void
}

interface FocusProviderProps {
  children: ReactNode
}

const FocusContext = createContext<FocusValue | null>(null)

export function FocusProvider({ children }: FocusProviderProps) {
  const [state, setState] = useState<FocusState>({ focusedId: null, dismissedId: null })
  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null)

  const select = useCallback((stationId: string) => {
    setState({ focusedId: stationId, dismissedId: null })
    setFlyRequest((prev) => ({ stationId, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])
  const dismiss = useCallback(
    () => setState((s) => (s.focusedId === null ? s : { focusedId: null, dismissedId: s.focusedId })),
    [],
  )
  const updateFromCamera = useCallback(
    (distance: number, target: Ground, stations: readonly Station[]) =>
      setState((prev) => {
        const next = nextFocus({ ...prev, distance, target, stations })
        return next.focusedId === prev.focusedId && next.dismissedId === prev.dismissedId
          ? prev
          : { focusedId: next.focusedId, dismissedId: next.dismissedId }
      }),
    [],
  )

  const { focusedId, dismissedId } = state
  const value = useMemo<FocusValue>(
    () => ({ focusedId, dismissedId, flyRequest, select, dismiss, updateFromCamera }),
    [focusedId, dismissedId, flyRequest, select, dismiss, updateFromCamera],
  )
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}

export function useFocus(): FocusValue {
  const value = useContext(FocusContext)
  if (!value) throw new Error('useFocus must be used inside <FocusProvider>')
  return value
}
