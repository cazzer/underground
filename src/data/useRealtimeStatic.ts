import { useEffect, useState } from 'react'
import type { StaticRealtimeData } from '../lib/realtime/prepareTrips'
import type { DrawnShape } from '../lib/realtime/shapeGeometry'
import type { NetworkFiles } from './loadNetwork'
import { loadRealtimeStatic } from './loadRealtimeStatic'
import type { ShapeId } from './schema'

export type RealtimeStaticLoad =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: StaticRealtimeData }

/**
 * Loads the realtime join data once `files` is available, on the map's drawn tracks (`drawn`, network.shapeById).
 * Idle while `files` is null. No retry: a reload retries.
 */
export function useRealtimeStatic(
  files: NetworkFiles | null,
  trackOffsetM: number,
  drawn: ReadonlyMap<ShapeId, DrawnShape>,
): RealtimeStaticLoad {
  const [load, setLoad] = useState<RealtimeStaticLoad>({ status: 'idle' })

  useEffect(() => {
    if (!files) return
    const controller = new AbortController()
    setLoad({ status: 'loading' })
    loadRealtimeStatic(import.meta.env.BASE_URL, files, trackOffsetM, drawn, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setLoad({ status: 'ready', data })
      },
      (err: unknown) => {
        if (controller.signal.aborted) return
        console.error('Failed to load realtime join data', err)
        setLoad({ status: 'error', message: `${err instanceof Error ? err.message : String(err)}; reload to retry` })
      },
    )
    return () => controller.abort()
  }, [files, trackOffsetM, drawn])

  return files ? load : { status: 'idle' }
}
