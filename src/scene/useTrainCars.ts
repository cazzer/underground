import { type RefObject, useEffect, useMemo, useRef } from 'react'
import { type BufferGeometry, type Color, DynamicDrawUsage, type InstancedMesh } from 'three'
import { type Consist, consistFor, DEFAULT_CONSIST, MAX_CARS } from '../lib/live/consist'
import { type CarFrame, clearCars, createConsistScratch, writeConsist } from '../lib/live/consistLayout'
import { TRAIN_CAPACITY } from '../lib/live/slots'
import type { Polyline } from '../lib/realtime/polyline'
import { theme } from '../theme'
import { screenScale } from './cameraDistance'
import { createCarBodyGeometry, createCarHaloGeometry } from './carGeometry'
import { carLook } from './carLook'

export const CAR_CAPACITY = TRAIN_CAPACITY * MAX_CARS
const CAR_Y = 0.5
/** Gap between car bodies and the halo rim around them: real meters zoomed in, a few pixels farther out. */
const GAP = { px: 1.5, minM: 1.2 }
const RIM = { px: 1, minM: 0.5 }
/** A car body is never narrower than this on screen, so a train still reads through the dot handoff. */
const MIN_WIDTH_PX = 5
/** Body widening per slot (1 + (slot % 8) * step), so two trains on one shape don't z-fight. */
const WIDEN_STEP = 0.01

export interface TrainCarsLayer {
  bodies: RefObject<InstancedMesh | null>
  halos: RefObject<InstancedMesh | null>
  geometry: { body: BufferGeometry; halo: BufferGeometry }
  /** Before the first frame: dynamic usage, cleared matrices, nothing drawn. */
  prepare(): void
  /** A slot's route changed: its consist and the color of its cars. */
  setSlot(i: number, routeId: string | null, color: Color): void
  /** Per-frame sizes for the camera distance; call before writeTrain. */
  beginFrame(cameraDistance: number): void
  /** Lays out slot i's cars at `shown` along `line`: `mix` unfolds the train from the dot, `k` is the slot's fade. */
  writeTrain(i: number, line: Polyline, shown: number, mix: number, k: number): void
  /** Hides slot i's cars. */
  clear(i: number): void
  /** Uploads slots [0, high) and draws them, or draws none when inactive. */
  commit(high: number, active: boolean): void
}

/** Car instances for the live trains: per-slot consists and colors, written per frame without allocating. */
export function useTrainCars(): TrainCarsLayer {
  const bodies = useRef<InstancedMesh>(null)
  const halos = useRef<InstancedMesh>(null)
  const geometry = useMemo(
    () => ({
      body: createCarBodyGeometry(carLook, theme.trainCarSideShade, theme.trainCarEndShade),
      halo: createCarHaloGeometry(),
    }),
    [],
  )

  useEffect(
    () => () => {
      geometry.body.dispose()
      geometry.halo.dispose()
    },
    [geometry],
  )

  const layer = useMemo((): Omit<TrainCarsLayer, 'bodies' | 'halos' | 'geometry'> => {
    const consists = new Array<Consist>(TRAIN_CAPACITY).fill(DEFAULT_CONSIST)
    const frame: CarFrame = { gapM: GAP.minM, rimM: RIM.minM, widthM: carLook.widthM, crossScale: 1, y: CAR_Y }
    const scratch = createConsistScratch()
    const range = { start: 0, count: 0 }
    return {
      prepare() {
        for (const m of [bodies.current, halos.current]) {
          if (!m) continue
          m.instanceMatrix.setUsage(DynamicDrawUsage)
          ;(m.instanceMatrix.array as Float32Array).fill(0)
          m.instanceMatrix.needsUpdate = true
          m.count = 0
        }
      },
      setSlot(i, routeId, color) {
        consists[i] = consistFor(routeId)
        const b = bodies.current
        if (!b) return
        for (let c = 0; c < MAX_CARS; c++) b.setColorAt(i * MAX_CARS + c, color)
        b.instanceColor!.needsUpdate = true
      },
      beginFrame(cameraDistance) {
        frame.gapM = screenScale(cameraDistance, GAP.px, GAP.minM)
        frame.rimM = screenScale(cameraDistance, RIM.px, RIM.minM)
        frame.crossScale = screenScale(cameraDistance, MIN_WIDTH_PX, carLook.widthM) / carLook.widthM
      },
      writeTrain(i, line, shown, mix, k) {
        const b = bodies.current
        const h = halos.current
        if (!b || !h) return
        const widen = 1 + (i % 8) * WIDEN_STEP
        const out = b.instanceMatrix.array as Float32Array
        writeConsist(out, h.instanceMatrix.array as Float32Array, i, line, shown, consists[i]!, mix, k, widen, frame, scratch)
      },
      clear(i) {
        const b = bodies.current
        const h = halos.current
        if (b && h) clearCars(b.instanceMatrix.array as Float32Array, h.instanceMatrix.array as Float32Array, i)
      },
      commit(high, active) {
        const b = bodies.current
        const h = halos.current
        if (!b || !h) return
        b.count = h.count = active ? high * MAX_CARS : 0
        if (!active) return
        // three empties the ranges after each upload, so the (reused) range goes back in.
        range.count = high * MAX_CARS * 16
        b.instanceMatrix.updateRanges.push(range)
        h.instanceMatrix.updateRanges.push(range)
        b.instanceMatrix.needsUpdate = true
        h.instanceMatrix.needsUpdate = true
      },
    }
  }, [])

  return useMemo(() => ({ bodies, halos, geometry, ...layer }), [geometry, layer])
}
