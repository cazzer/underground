import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export interface FlyRequest {
  stationId: string
  /** Changes on every request so re-selecting the same station flies again. */
  nonce: number
}

interface FocusValue {
  focusedId: string | null
  flyRequest: FlyRequest | null
  /** Explicit pick (click): focus the station and fly the camera to it. */
  select: (stationId: string) => void
  /** Focus changed because the camera got near/far; no fly. */
  setFocusedFromCamera: (stationId: string | null) => void
  clear: () => void
}

const FocusContext = createContext<FocusValue | null>(null)

export function FocusProvider({ children }: { children: ReactNode }) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null)

  const select = useCallback((stationId: string) => {
    setFocusedId(stationId)
    setFlyRequest((prev) => ({ stationId, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])
  const clear = useCallback(() => setFocusedId(null), [])

  const value = useMemo<FocusValue>(
    () => ({ focusedId, flyRequest, select, setFocusedFromCamera: setFocusedId, clear }),
    [focusedId, flyRequest, select, clear],
  )
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}

export function useFocus(): FocusValue {
  const value = useContext(FocusContext)
  if (!value) throw new Error('useFocus must be used inside <FocusProvider>')
  return value
}
