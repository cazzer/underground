import { useCallback, useEffect, useRef, useState } from 'react'
import { dismissLocate, failLocating, failureFromCode, placeFix, startLocating, toFix, type LocateFailure, type LocateState } from '../lib/locate'
import type { Network } from '../lib/network'
import type { Ground } from '../lib/projection'

/**
 * Longer than the request's own timeout: Firefox's "Not now" never calls back, so this ends the wait.
 * It only stops the HUD waiting: the request stays live, so an Allow that arrives later still lands
 * and flies (until the user presses again or clears).
 */
const WATCHDOG_MS = 30_000
const OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }

export interface LocateControls {
  state: LocateState
  /** Asks the browser for one position. Call only from a user press. */
  locate: () => void
  /** Clears a shown location, cancels a pending request, or dismisses a failure (keeping the last good fix). */
  clear: () => void
}

/**
 * The user's location, asked for on press only (one `getCurrentPosition`, never watched). The fix
 * lives in React state and nowhere else: no storage, URL, request or log carries it.
 */
export function useLocate(network: Network, flyToPoint: (center: Ground, radiusM: number, source: 'locate') => unknown): LocateControls {
  const [state, setState] = useState<LocateState>({ status: 'idle' })
  // Read at callback time so `locate` and `clear` keep one identity.
  const latest = useRef({ network, flyToPoint })
  useEffect(() => {
    latest.current = { network, flyToPoint }
  }, [network, flyToPoint])
  // Bumped by every press, clear and unmount; a callback from an older request does nothing.
  const requestId = useRef(0)
  const busy = useRef(false)
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopWatchdog = useCallback(() => {
    if (watchdog.current !== null) clearTimeout(watchdog.current)
    watchdog.current = null
  }, [])

  const settle = useCallback(
    (id: number, next: (prev: LocateState) => LocateState) => {
      if (id !== requestId.current) return
      stopWatchdog()
      busy.current = false
      setState(next)
    },
    [stopWatchdog],
  )

  const locate = useCallback(() => {
    if (busy.current) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState((prev) => failLocating(prev, 'unsupported'))
      return
    }
    const id = ++requestId.current
    busy.current = true
    setState(startLocating)
    const fail = (reason: LocateFailure) => settle(id, (prev) => failLocating(prev, reason))
    watchdog.current = setTimeout(() => fail('timeout'), WATCHDOG_MS)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (id !== requestId.current) return
        const fix = toFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy)
        const placement = fix && placeFix(fix, latest.current.network.stations, latest.current.network.bounds)
        if (!placement) {
          console.warn('Geolocation returned an unusable position')
          fail('unavailable')
          return
        }
        settle(id, () => ({ status: 'located', placement }))
        if (placement.kind !== 'outside') latest.current.flyToPoint(placement.viewCenter, placement.viewRadiusM, 'locate')
      },
      (err) => {
        // Code and message only: never the position.
        console.warn(`Geolocation failed (code ${err.code}): ${err.message}`)
        fail(failureFromCode(err.code))
      },
      OPTIONS,
    )
  }, [settle])

  const clear = useCallback(() => {
    requestId.current++
    busy.current = false
    stopWatchdog()
    setState(dismissLocate)
  }, [stopWatchdog])

  // Unmount: drop any pending result.
  useEffect(
    () => () => {
      requestId.current++
      stopWatchdog()
    },
    [stopWatchdog],
  )

  return { state, locate, clear }
}
