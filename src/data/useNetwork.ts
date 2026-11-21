import { useCallback, useEffect, useState } from 'react'
import type { Network } from '../lib/network'
import type { BandedShapes } from '../lib/networkBands'
import { loadBands } from './loadBands'
import { showGenerated } from './generatedLook'
import { loadNetwork, type NetworkFiles } from './loadNetwork'
import { TRACK_OFFSET_M } from '../lib/trackOffset'
import { interiorLook } from '../scene/interiorLook'

export type NetworkLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** `bands` resolves after the first paint (loadBands.ts); it rejects only on unmount or retry. */
  | { status: 'ready'; network: Network; files: NetworkFiles; bands: Promise<BandedShapes> }

/** Loads public/data once per mount (and again on `retry`). */
export function useNetwork(): { load: NetworkLoad; retry: () => void } {
  const [load, setLoad] = useState<NetworkLoad>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    // The interior's vertical scale, so the tracks descend to the rails the interior draws.
    loadNetwork(import.meta.env.BASE_URL, TRACK_OFFSET_M, interiorLook.yScale, controller.signal, { generatedDepths: showGenerated }).then(
      ({ network, files }) => {
        if (controller.signal.aborted) return
        const bands = loadBands(network, controller.signal)
        // It rejects only on the abort below (nothing waits on that); anything else is a bug worth seeing.
        bands.catch((err: unknown) => {
          if (!controller.signal.aborted) console.error('Shared corridors: unexpected failure', err)
        })
        setLoad({ status: 'ready', network, files, bands })
      },
      (err: unknown) => {
        if (controller.signal.aborted) return
        console.error('Failed to load subway data', err)
        setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      },
    )
    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => {
    setLoad({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  return { load, retry }
}
