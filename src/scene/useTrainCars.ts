import { type RefObject, useEffect, useMemo, useRef } from 'react'
import { type BufferGeometry, type Color, DynamicDrawUsage, type InstancedMesh } from 'three'
import { type Consist, consistFor, DEFAULT_CONSIST, MAX_CARS } from '../lib/live/consist'
import { type CarFrame, clearCars, createConsistScratch, writeConsist } from '../lib/live/consistLayout'
import { createRangePool, pushDirtyRanges } from '../lib/live/dirtyRanges'
import { TRAIN_CAPACITY } from '../lib/live/slots'
import type { BandView } from '../lib/bandOffset'
import type { DrawnTrack } from '../lib/live/trackPoint'
import { theme } from '../theme'
import { screenScale } from './cameraDistance'
import { CAR_HEIGHT_M, CAR_WIDTH_M, createCarBodyGeometry, createCarHaloGeometry } from './carGeometry'

export const CAR_CAPACITY = TRAIN_CAPACITY * MAX_CARS
const CAR_Y = 0.5
/** Gap between car bodies and the halo rim around them: real meters zoomed in, a few pixels farther out. */
const GAP = { px: 1.5, minM: 1.2 }
const RIM = { px: 1, minM: 0.5 }
/** The selected train: a background gap around its cars, then a rim in the selection color outside it. */
const SELECTED_GAP = { px: 2, minM: 0.8 }
const SELECTED_RIM = { px: 2.5, minM: 1 }
/** A car body is never narrower than this on screen, so a train still reads through the dot handoff. */
const MIN_WIDTH_PX = 5
/**
 * Body widening per slot, 1 + level * step with 16 levels hashed from the slot, so two trains on one shape
 * (express and local) don't z-fight: neighbouring slots, often the same line, get unrelated levels.
 */
const WIDEN_STEP = 0.005
const widenFor = (slot: number): number => 1 + (Math.imul(slot, 0x9e3779b1) >>> 28) * WIDEN_STEP
/**
 * The selected train sits above every level and a little higher, so where another train shares or parallels
 * its corridor the selected roof wins the depth test.
 */
const SELECTED_WIDEN = 1 + 16 * WIDEN_STEP
const SELECTED_LIFT_M = 0.2
const STRIDE = MAX_CARS * 16
/** Clean slots an upload range may span between dirty ones: fewer bufferSubData calls for a few KB more. */
const BRIDGE_SLOTS = 16

export interface TrainCarsLayer {
  bodies: RefObject<InstancedMesh | null>
  halos: RefObject<InstancedMesh | null>
  /** The selected train's rim footprints, MAX_CARS instances drawn under the car halos. */
  rims: RefObject<InstancedMesh | null>
  geometry: { body: BufferGeometry; halo: BufferGeometry }
  /** Before the first frame: dynamic usage, cleared matrices, nothing drawn. */
  prepare(): void
  /** A slot's route changed: its consist and the color of its cars. */
  setSlot(i: number, routeId: string | null, color: Color): void
  /** The consist slot i is drawn with. */
  consistOf(i: number): Consist
  /** The selected slot (-1 for none): its cars get a wider background gap and the selection rim outside it. */
  setSelected(i: number): void
  /** Car body height this frame at full unfold, before a slot's fade. */
  carHeightM(): number
  /** Per-frame sizes for the camera distance; call before writeTrain. */
  beginFrame(cameraDistance: number): void
  /** Lays out slot i's cars at `shown` along `track`, as drawn in `view`: `mix` unfolds the train from the dot, `k` is the slot's fade. */
  writeTrain(i: number, track: DrawnTrack, view: BandView, shown: number, mix: number, k: number): void
  /** Hides slot i's cars (a freed slot). */
  clear(i: number): void
  /** Hides slot i's cars while it is off screen; zeroes them once, not every frame. */
  hide(i: number): void
  /** Draws slots [0, high) and uploads the ones written since the last upload, or draws none when inactive. */
  commit(high: number, active: boolean): void
}

/** Car instances for the live trains: per-slot consists and colors, written per frame without allocating. */
export function useTrainCars(): TrainCarsLayer {
  const bodies = useRef<InstancedMesh>(null)
  const halos = useRef<InstancedMesh>(null)
  const rims = useRef<InstancedMesh>(null)
  const geometry = useMemo(
    () => ({
      body: createCarBodyGeometry(theme.trainCarSideShade, theme.trainCarEndShade),
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

  const layer = useMemo((): Omit<TrainCarsLayer, 'bodies' | 'halos' | 'rims' | 'geometry'> => {
    const consists = new Array<Consist>(TRAIN_CAPACITY).fill(DEFAULT_CONSIST)
    const frame: CarFrame = { gapM: GAP.minM, rimM: RIM.minM, widthM: CAR_WIDTH_M, crossScale: 1, y: CAR_Y }
    const gapFrame: CarFrame = { ...frame, rimM: SELECTED_GAP.minM, y: CAR_Y + SELECTED_LIFT_M }
    const rimFrame: CarFrame = { ...frame, rimM: SELECTED_GAP.minM + SELECTED_RIM.minM }
    /** writeConsist writes bodies with the footprints; the rim's bodies land here and are never drawn. */
    const rimBodies = new Float32Array(MAX_CARS * 16)
    let selected = -1
    let rimDirty = false
    const zeroRim = (): void => {
      const r = rims.current
      if (!r) return
      clearCars(rimBodies, r.instanceMatrix.array as Float32Array, 0)
      rimDirty = true
    }
    const scratch = createConsistScratch()
    /** Slots whose matrices changed since the last upload, and slots whose cars are already zeroed. */
    const dirty = new Uint8Array(TRAIN_CAPACITY)
    const hidden = new Uint8Array(TRAIN_CAPACITY)
    // three merges ranges in place, so each buffer gets its own range objects.
    const pools = { bodies: createRangePool(TRAIN_CAPACITY / 2), halos: createRangePool(TRAIN_CAPACITY / 2) }
    const zero = (i: number): void => {
      const b = bodies.current
      const h = halos.current
      if (!b || !h) return
      clearCars(b.instanceMatrix.array as Float32Array, h.instanceMatrix.array as Float32Array, i)
      if (i === selected) zeroRim()
      hidden[i] = 1
      dirty[i] = 1
    }
    return {
      prepare() {
        // Everything zeroed, and every slot uploaded with the first ranges (the GPU copy may be stale).
        hidden.fill(1)
        dirty.fill(1)
        for (const m of [bodies.current, halos.current, rims.current]) {
          if (!m) continue
          m.instanceMatrix.setUsage(DynamicDrawUsage)
          ;(m.instanceMatrix.array as Float32Array).fill(0)
          m.instanceMatrix.needsUpdate = true
          m.count = 0
        }
        selected = -1
      },
      setSlot(i, routeId, color) {
        consists[i] = consistFor(routeId)
        const b = bodies.current
        if (!b) return
        for (let c = 0; c < MAX_CARS; c++) b.setColorAt(i * MAX_CARS + c, color)
        b.instanceColor!.needsUpdate = true
      },
      consistOf: (i) => consists[i]!,
      setSelected(i) {
        if (i === selected) return
        zeroRim()
        // The old selection is rewritten with the normal halo next frame it is laid out.
        if (selected >= 0) dirty[selected] = 1
        selected = i
      },
      carHeightM: () => CAR_HEIGHT_M * frame.crossScale,
      beginFrame(cameraDistance) {
        frame.gapM = gapFrame.gapM = rimFrame.gapM = screenScale(cameraDistance, GAP.px, GAP.minM)
        frame.rimM = screenScale(cameraDistance, RIM.px, RIM.minM)
        gapFrame.rimM = screenScale(cameraDistance, SELECTED_GAP.px, SELECTED_GAP.minM)
        rimFrame.rimM = gapFrame.rimM + screenScale(cameraDistance, SELECTED_RIM.px, SELECTED_RIM.minM)
        frame.crossScale = screenScale(cameraDistance, MIN_WIDTH_PX, CAR_WIDTH_M) / CAR_WIDTH_M
        gapFrame.crossScale = rimFrame.crossScale = frame.crossScale
      },
      writeTrain(i, track, view, shown, mix, k) {
        const b = bodies.current
        const h = halos.current
        if (!b || !h) return
        const out = b.instanceMatrix.array as Float32Array
        const consist = consists[i]!
        const widen = i === selected ? SELECTED_WIDEN : widenFor(i)
        writeConsist(out, h.instanceMatrix.array as Float32Array, i, track, view, shown, consist, mix, k, widen, i === selected ? gapFrame : frame, scratch)
        const r = rims.current
        if (i === selected && r) {
          writeConsist(rimBodies, r.instanceMatrix.array as Float32Array, 0, track, view, shown, consist, mix, k, widen, rimFrame, scratch)
          rimDirty = true
        }
        hidden[i] = 0
        dirty[i] = 1
      },
      clear: zero,
      hide(i) {
        if (hidden[i] === 0) zero(i)
      },
      commit(high, active) {
        const b = bodies.current
        const h = halos.current
        const r = rims.current
        if (!b || !h || !r) return
        b.count = h.count = active ? high * MAX_CARS : 0
        r.count = active && selected >= 0 ? MAX_CARS : 0
        if (!active) return
        if (rimDirty) r.instanceMatrix.needsUpdate = true
        rimDirty = false
        // Only changed slots go up. needsUpdate without ranges would upload the whole buffer, so skip it then.
        if (pushDirtyRanges(dirty, high, STRIDE, BRIDGE_SLOTS, pools.bodies, b.instanceMatrix.updateRanges) === 0) return
        pushDirtyRanges(dirty, high, STRIDE, BRIDGE_SLOTS, pools.halos, h.instanceMatrix.updateRanges)
        // `dirty` is cleared once the ranges are pushed, not once three uploads them, so both meshes must be
        // rendered every frame they are active (frustumCulled off in TrainCars.tsx): a skipped mesh would keep
        // reusable range objects that the next commit's pool overwrites, and lose those slots' updates.
        dirty.fill(0, 0, high)
        b.instanceMatrix.needsUpdate = true
        h.instanceMatrix.needsUpdate = true
      },
    }
  }, [])

  return useMemo(() => ({ bodies, halos, rims, geometry, ...layer }), [geometry, layer])
}
