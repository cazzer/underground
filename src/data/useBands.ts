import { useEffect, useState } from 'react'
import type { BandedShapes } from '../lib/networkBands'

/** useNetwork's `bands` once resolved (after the first paint); null until then. */
export function useBands(bands: Promise<BandedShapes>): BandedShapes | null {
  const [resolved, setResolved] = useState<{ from: Promise<BandedShapes>; value: BandedShapes } | null>(null)
  useEffect(() => {
    let current = true
    bands.then(
      (value) => {
        if (current) setResolved({ from: bands, value })
      },
      (err: unknown) => {
        // Only an abort (a retry or unmount) rejects it, and nothing then waits for the bands.
        if (!(err instanceof DOMException && err.name === 'AbortError')) console.error('Shared corridors failed', err)
      },
    )
    return () => {
      current = false
    }
  }, [bands])
  return resolved?.from === bands ? resolved.value : null
}
