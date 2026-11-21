/**
 * The network's bands, after the first paint: the corridor search runs in a worker (bandWorker.ts), then the
 * banded shapes are resampled here. Without a worker, or if it fails (logged), the search runs on this thread
 * once the browser is idle; if that fails too (logged), the map and trains keep the unbanded shapes.
 */
import type { ShapeBands } from '../lib/corridors'
import type { Network } from '../lib/network'
import { bandNetwork, bandShapes, type BandedShapes } from '../lib/networkBands'
import { EMPTY_PROFILE, type TrackProfile } from '../lib/trackProfile'
import type { BandRequest, BandResponse } from './bandWorker'
import type { ShapeId } from './schema'

function request(network: Network): { message: BandRequest; transfer: Transferable[] } {
  const transfer: Transferable[] = []
  const shapes = network.trackLines.map((t) => {
    const xz = new Float64Array(t.line.points.length * 2)
    t.line.points.forEach((p, i) => {
      xz[i * 2] = p.x
      xz[i * 2 + 1] = p.z
    })
    transfer.push(xz.buffer)
    return { id: t.id, routeId: t.routeId, direction: t.direction, primary: t.primary, xz }
  })
  const routes = network.routes.map((r) => ({ id: r.id, shortName: r.shortName }))
  return { message: { shapes, routes }, transfer }
}

/** A cloned empty profile is a fresh object: restore the shared one, which code may compare by identity. */
const profile = (p: TrackProfile): TrackProfile => (p.d.length === 0 ? EMPTY_PROFILE : p)

function onIdle(run: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1000 })
  else setTimeout(run, 0)
}

/** No bands: the shapes the first paint drew. */
export function unbanded(network: Network): BandedShapes {
  return { shapes: network.shapes, shapeById: network.shapeById, bands: new Map() }
}

/** Bands on this thread when the browser is idle. */
function bandsHere(network: Network, signal: AbortSignal): Promise<BandedShapes> {
  return new Promise((resolve, reject) => {
    onIdle(() => {
      if (signal.aborted) return reject(signal.reason)
      try {
        resolve(bandNetwork(network))
      } catch (err) {
        console.error('Finding shared corridors failed; routes draw without bands', err)
        resolve(unbanded(network))
      }
    })
  })
}

/**
 * Resolves with the banded shapes (or, after a logged failure, the unbanded ones); rejects only when `signal`
 * aborts, which terminates the worker.
 */
export function loadBands(network: Network, signal: AbortSignal): Promise<BandedShapes> {
  if (typeof Worker === 'undefined') return bandsHere(network, signal)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./bandWorker.ts', import.meta.url), { type: 'module' })
    const fallBack = (why: string) => {
      worker.terminate()
      console.error(`Band worker failed (${why}); finding corridors on the main thread`)
      bandsHere(network, signal).then(resolve, reject)
    }
    signal.addEventListener('abort', () => {
      worker.terminate()
      reject(signal.reason)
    })
    worker.onerror = (e) => fallBack(e.message || 'worker error')
    worker.onmessageerror = () => fallBack('unreadable reply')
    worker.onmessage = (e: MessageEvent<BandResponse>) => {
      worker.terminate()
      if ('error' in e.data) return fallBack(e.data.error)
      const bands = new Map<ShapeId, ShapeBands>(e.data.bands.map(([id, b]) => [id, { slot: profile(b.slot), half: profile(b.half) }]))
      try {
        resolve(bandShapes(network, bands))
      } catch (err) {
        console.error('Drawing the shared corridors failed; routes draw without bands', err)
        resolve(unbanded(network))
      }
    }
    const { message, transfer } = request(network)
    worker.postMessage(message, transfer)
  })
}
