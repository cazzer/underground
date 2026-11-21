import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { FocusState } from './focusMachine'

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
  /** Focus state changed because the camera got near/far; no fly. */
  setFromCamera: (next: FocusState) => void
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
  const setFromCamera = useCallback(
    (next: FocusState) =>
      setState((prev) =>
        prev.focusedId === next.focusedId && prev.dismissedId === next.dismissedId ? prev : next,
      ),
    [],
  )

  const { focusedId, dismissedId } = state
  const value = useMemo<FocusValue>(
    () => ({ focusedId, dismissedId, flyRequest, select, dismiss, setFromCamera }),
    [focusedId, dismissedId, flyRequest, select, dismiss, setFromCamera],
  )
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}

export function useFocus(): FocusValue {
  const value = useContext(FocusContext)
  if (!value) throw new Error('useFocus must be used inside <FocusProvider>')
  return value
}
