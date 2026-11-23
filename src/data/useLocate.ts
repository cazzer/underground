import { useCallback, useEffect, useRef, useState } from 'react'
import { dismissLocate, failLocating, failureFromCode, markedPlacement, placeFix, startLocating, toFix, type LocateFailure, type LocateState, type MarkedPlacement } from '../lib/locate'
import type { Network } from '../lib/network'
import { rememberLocate, rememberUnviewedFix, type LocateMemory } from '../lib/locateMemory'
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
  /** Asks the browser for one position and flies to it. Call only from a user press (the header button). */
  locate: () => void
  /**
   * The same one position, no flight (the search dialog's press: a flight behind a modal would drop focus and end a
   * follow). A request the header already has pending still flies. Call only from a user press.
   */
  find: () => void
  /** Flies to the shown fix as the header press does; nothing when none is shown. Call only from a user press. */
  showFix: () => void
  /** Clears a shown location, cancels a pending request, or dismisses a failure (keeping the last good fix). */
  clear: () => void
}

const memoryOf = (placement: MarkedPlacement): LocateMemory => ({
  center: placement.viewCenter,
  radiusM: placement.viewRadiusM,
  nearestId: placement.nearest.id,
})

/** The view now sits over the fix: the address search must keep its bias away from here (lib/geocodeFocus.ts). */
function flyTo(placement: MarkedPlacement, flyToPoint: (center: Ground, radiusM: number, source: 'locate') => unknown): void {
  rememberLocate(memoryOf(placement))
  flyToPoint(placement.viewCenter, placement.viewRadiusM, 'locate')
}

/**
 * The user's location, asked for on press only (one `getCurrentPosition`, never watched). The fix
 * lives in React state and nowhere else: no storage, URL, request or log carries it.
 */
export function useLocate(network: Network, flyToPoint: (center: Ground, radiusM: number, source: 'locate') => unknown): LocateControls {
  const [state, setState] = useState<LocateState>({ status: 'idle' })
  // Read at callback time so `locate` and `clear` keep one identity.
  const latest = useRef({ network, flyToPoint, state })
  useEffect(() => {
    latest.current = { network, flyToPoint, state }
  }, [network, flyToPoint, state])
  // Bumped by every press, clear and unmount; a callback from an older request does nothing.
  const requestId = useRef(0)
  const busy = useRef(false)
  // Whether the pending request ends in a flight: the header's press does, the dialog's does not.
  const fly = useRef(true)
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

  const request = useCallback(() => {
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
        const placement = fix && placeFix(fix, latest.current.network.stations, latest.current.network.groupById, latest.current.network.bounds)
        if (!placement) {
          console.warn('Geolocation returned an unusable position')
          fail('unavailable')
          return
        }
        settle(id, () => ({ status: 'located', placement }))
        if (placement.kind !== 'outside') {
          if (fly.current) flyTo(placement, latest.current.flyToPoint)
          else rememberUnviewedFix(memoryOf(placement))
        }
      },
      (err) => {
        // Code and message only: never the position.
        console.warn(`Geolocation failed (code ${err.code}): ${err.message}`)
        fail(failureFromCode(err.code))
      },
      OPTIONS,
    )
  }, [settle])

  const locate = useCallback(() => {
    fly.current = true
    request()
  }, [request])

  const find = useCallback(() => {
    if (!busy.current) fly.current = false
    request()
  }, [request])

  const showFix = useCallback(() => {
    const placement = markedPlacement(latest.current.state)
    if (placement) flyTo(placement, latest.current.flyToPoint)
  }, [])

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

  return { state, locate, find, showFix, clear }
}
