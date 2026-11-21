import { useCallback, useEffect, useState } from 'react'
import type { Network } from '../lib/network'
import { loadNetwork } from './loadNetwork'

export type NetworkLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; network: Network }

/** Loads public/data once per mount (and again on `retry`). */
export function useNetwork(): { load: NetworkLoad; retry: () => void } {
  const [load, setLoad] = useState<NetworkLoad>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    loadNetwork(import.meta.env.BASE_URL, controller.signal).then(
      (network) => {
        if (!controller.signal.aborted) setLoad({ status: 'ready', network })
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
