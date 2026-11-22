import { type RefObject, useEffect, useMemo, useRef } from 'react'
import { BackSide, type BufferGeometry, Color, DynamicDrawUsage, type InstancedMesh, MeshBasicMaterial } from 'three'
import { type Consist, MAX_CARS } from '../lib/live/consist'
import { consistSpanInto, type ConsistSpan } from '../lib/live/consistLayout'
import { slotScale, TRAIN_CAPACITY, type SlotTable } from '../lib/live/slots'
import { trainSpanWeight, veilTint, type StationSpans } from '../lib/platformSpan'
import { theme } from '../theme'
import { interiorLook } from './interiorLook'
import type { TrainCarsLayer } from './useTrainCars'
import { VEIL_TINT_ATTRIBUTE, veilTintMaterial, withTintAttribute } from './veilTint'

/** Trains drawn above the veil at once: a station's platforms hold a few, with room for ones pulling in and out. */
export const SPAN_TRAINS = 12
export const SPAN_CARS = SPAN_TRAINS * MAX_CARS
/**
 * Look A's screen-wide veil dims every street train, so a lifted car mixes toward it as it leaves the span. Look B's
 * footprint veil covers only the station's outline (its edge is near the platform ends, the span ramps out past
 * them), so cars stay as they are. Look C has no veil and draws the interior under the street: nothing is lifted.
 */
const VEIL_TINT = interiorLook.veil === 'screen' ? interiorLook.veilOpacity : 0
export const SPAN_LIFT = !interiorLook.under

const WHITE = new Color(1, 1, 1)

/** For the `?debug` overlay: the most trains ever left unlifted in one frame because the meshes were full. */
export const spanCarStats = { peakOverflow: 0 }

export interface SpanCarsLayer {
  bodies: RefObject<InstancedMesh | null>
  halos: RefObject<InstancedMesh | null>
  /** The selected train's outline shells (useTrainCars' rims and gaps), copied for its lifted cars. */
  rims: RefObject<InstancedMesh | null>
  gaps: RefObject<InstancedMesh | null>
  /**
   * The copies' geometry and materials: bodies and rims carry a per-instance veil tint (veilTint.ts); the gap is the
   * background, which the tint would mix toward itself.
   */
  geometry: { body: BufferGeometry; halo: BufferGeometry; rim: BufferGeometry; gap: BufferGeometry }
  material: { body: MeshBasicMaterial; rim: MeshBasicMaterial; gap: MeshBasicMaterial }
  /** Before the first frame: dynamic usage, instance colors allocated, nothing drawn. */
  prepare(): void
  /**
   * After this frame's cars are written: copies every car with a span weight above 0 (`spans` is the focused
   * station's platform spans, null for none) into the above-veil meshes, with the selected train's rim, each mixed
   * toward the veil by how far it is past the platform. `reveal` is the interior's opacity; at 0 nothing draws.
   * `veil` is the veil's weight (interiorReveal.ts veilWeight), which the tint follows as the veil does.
   * With more than SPAN_TRAINS candidates, the ones most on the platforms win. No allocation; never throws.
   */
  write(
    table: SlotTable,
    spans: StationSpans | null,
    reveal: number,
    veil: number,
    mix: number,
    localS: number,
    selected: number,
    colors: readonly (Color | null)[],
    consistOf: (slot: number) => Consist,
  ): void
}

function copyMatrix(from: ArrayLike<number>, fromIndex: number, to: Float32Array, toIndex: number): void {
  const s = fromIndex * 16
  const d = toIndex * 16
  for (let j = 0; j < 16; j++) to[d + j] = from[s + j]!
}

/**
 * The above-veil copies of the live trains on a revealed station's platforms: the same car matrices (copied from
 * `cars`, so widening, the selected lift and the rim stay identical) in small meshes drawn after the interior.
 * Only cars with a weight above 0 are copied, so past the ramp the street cars (and the strokes over them) show as
 * they are; a copy at a tiny weight renders like its veiled original, so the hand-off doesn't show.
 */
export function useSpanCars(cars: TrainCarsLayer): SpanCarsLayer {
  const bodies = useRef<InstancedMesh>(null)
  const halos = useRef<InstancedMesh>(null)
  const rims = useRef<InstancedMesh>(null)
  const gaps = useRef<InstancedMesh>(null)
  const parts = useMemo(() => {
    const body = withTintAttribute(cars.geometry.body, SPAN_CARS)
    const rim = withTintAttribute(cars.geometry.outline, MAX_CARS)
    const shell = { transparent: true, depthTest: true, depthWrite: false, side: BackSide }
    return {
      geometry: { body: body.geometry, halo: cars.geometry.halo, rim: rim.geometry, gap: cars.geometry.outline },
      tint: { body: body.tint, rim: rim.tint },
      material: {
        // White: vertex shading times the per-instance route color, as the street cars.
        body: veilTintMaterial({ vertexColors: true, transparent: true, depthTest: true, depthWrite: true }),
        rim: veilTintMaterial({ color: theme.trainSelectedRim, ...shell }),
        gap: new MeshBasicMaterial({ color: theme.background, ...shell }),
      },
    }
  }, [cars])

  useEffect(
    () => () => {
      parts.geometry.body.dispose()
      parts.geometry.rim.dispose()
      parts.material.body.dispose()
      parts.material.rim.dispose()
      parts.material.gap.dispose()
    },
    [parts],
  )

  const layer = useMemo((): Pick<SpanCarsLayer, 'prepare' | 'write'> => {
    const span: ConsistSpan = { cars: 0, pitch: 0, step: 0, rear: 0 }
    /** This frame's candidate slots and each one's highest car weight. */
    const candidates = new Int32Array(TRAIN_CAPACITY)
    const peaks = new Float64Array(TRAIN_CAPACITY)
    const layOut = (table: SlotTable, i: number, mix: number, localS: number, consistOf: (slot: number) => Consist): void => {
      const g = table.drawGeometry[i]!
      consistSpanInto(span, g.line.length, table.displayed[i]!, consistOf(i), mix * slotScale(table, i, localS))
    }
    const carWeight = (c: number, s: { d0: number; d1: number }): number => trainSpanWeight(span.rear + (c + 0.5) * span.step, s)
    return {
      prepare() {
        for (const m of [bodies.current, halos.current, rims.current, gaps.current]) {
          if (!m) continue
          m.instanceMatrix.setUsage(DynamicDrawUsage)
          m.count = 0
        }
        // Instance colors must exist before the first frame, or the shader compiles without them.
        const b = bodies.current
        if (b) {
          b.setColorAt(0, WHITE)
          b.instanceColor!.setUsage(DynamicDrawUsage)
        }
      },
      write(table, spans, reveal, veil, mix, localS, selected, colors, consistOf) {
        const b = bodies.current
        const h = halos.current
        const r = rims.current
        const gp = gaps.current
        const srcB = cars.bodies.current
        const srcH = cars.halos.current
        const srcR = cars.rims.current
        const srcG = cars.gaps.current
        if (!b || !h || !r || !gp || !srcB || !srcH || !srcR || !srcG || !b.instanceColor) return
        let n = 0
        let rimN = 0
        if (SPAN_LIFT && spans && reveal > 0) {
          let found = 0
          for (let i = 0; i < table.high; i++) {
            const g = table.drawGeometry[i]
            if (!table.trips[i] || !g || !colors[i] || Number.isNaN(table.displayed[i]!)) continue
            const s = spans.get(g.shapeId)
            if (!s) continue
            layOut(table, i, mix, localS, consistOf)
            let peak = 0
            for (let c = 0; c < span.cars; c++) peak = Math.max(peak, carWeight(c, s))
            if (peak <= 0) continue
            // Insertion by peak weight, highest first (a handful of candidates at most).
            let at = found++
            while (at > 0 && peaks[at - 1]! < peak) {
              candidates[at] = candidates[at - 1]!
              peaks[at] = peaks[at - 1]!
              at--
            }
            candidates[at] = i
            peaks[at] = peak
          }
          if (found > SPAN_TRAINS && found - SPAN_TRAINS > spanCarStats.peakOverflow) {
            spanCarStats.peakOverflow = found - SPAN_TRAINS
            console.warn(`Platform trains: ${found - SPAN_TRAINS} over the ${SPAN_TRAINS}-train capacity stay under the veil`)
          }
          const outB = b.instanceMatrix.array as Float32Array
          const outH = h.instanceMatrix.array as Float32Array
          const outR = r.instanceMatrix.array as Float32Array
          const outG = gp.instanceMatrix.array as Float32Array
          const bodyColors = b.instanceColor.array as Float32Array
          for (let t = 0; t < Math.min(found, SPAN_TRAINS); t++) {
            const i = candidates[t]!
            const s = spans.get(table.drawGeometry[i]!.shapeId)!
            const color = colors[i]!
            layOut(table, i, mix, localS, consistOf)
            for (let c = 0; c < span.cars; c++) {
              const w = carWeight(c, s)
              if (w <= 0) continue
              const tint = veilTint(veil, w, VEIL_TINT)
              copyMatrix(srcB.instanceMatrix.array, i * MAX_CARS + c, outB, n)
              copyMatrix(srcH.instanceMatrix.array, i * MAX_CARS + c, outH, n)
              bodyColors[n * 3] = color.r
              bodyColors[n * 3 + 1] = color.g
              bodyColors[n * 3 + 2] = color.b
              parts.tint.body[n] = tint
              n++
              if (i !== selected) continue
              copyMatrix(srcR.instanceMatrix.array, c, outR, rimN)
              copyMatrix(srcG.instanceMatrix.array, c, outG, rimN)
              parts.tint.rim[rimN++] = tint
            }
          }
        }
        b.count = h.count = n
        r.count = gp.count = rimN
        if (n === 0) return
        // A few KB per frame, only while cars are lifted.
        b.instanceMatrix.needsUpdate = true
        h.instanceMatrix.needsUpdate = true
        b.instanceColor.needsUpdate = true
        parts.geometry.body.getAttribute(VEIL_TINT_ATTRIBUTE).needsUpdate = true
        if (rimN === 0) return
        r.instanceMatrix.needsUpdate = gp.instanceMatrix.needsUpdate = true
        parts.geometry.rim.getAttribute(VEIL_TINT_ATTRIBUTE).needsUpdate = true
      },
    }
  }, [cars, parts])

  return useMemo(() => ({ bodies, halos, rims, gaps, geometry: parts.geometry, material: parts.material, ...layer }), [parts, layer])
}
