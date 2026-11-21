import { type RefObject, useMemo, useRef } from 'react'
import { Color, DynamicDrawUsage, type InstancedMesh } from 'three'
import { type Consist, MAX_CARS } from '../lib/live/consist'
import { consistSpanInto, type ConsistSpan } from '../lib/live/consistLayout'
import { slotScale, type SlotTable } from '../lib/live/slots'
import { trainSpanWeight, veilTint, type StationSpans } from '../lib/platformSpan'
import { theme } from '../theme'
import { interiorLook } from './interiorLook'
import type { TrainCarsLayer } from './useTrainCars'

/** Trains drawn above the veil at once: a station's platforms hold a few, with room for ones pulling in and out. */
export const SPAN_TRAINS = 12
export const SPAN_CARS = SPAN_TRAINS * MAX_CARS
const STRIDE = MAX_CARS * 16
/**
 * Look A's screen-wide veil dims every street train, so a lifted car mixes toward it as it leaves the span. Look B's
 * footprint veil covers only the station's outline (its edge is near the platform ends, the span ramps out past
 * them), so cars stay as they are. Look C has no veil and draws the interior under the street: nothing is lifted.
 */
const VEIL_TINT = interiorLook.veil === 'screen' ? interiorLook.veilOpacity : 0
export const SPAN_LIFT = !interiorLook.under

export interface SpanCarsLayer {
  bodies: RefObject<InstancedMesh | null>
  halos: RefObject<InstancedMesh | null>
  rims: RefObject<InstancedMesh | null>
  /** Before the first frame: dynamic usage, instance colors allocated, nothing drawn. */
  prepare(): void
  /**
   * After this frame's cars are written: copies the cars of every train near `spans` (the focused station's
   * platform spans, null for none) into the above-veil meshes, each car tinted toward the veil by how far it is
   * past the platform, and the selected train's rim with them. `reveal` is the interior's opacity; at 0 nothing
   * draws. No allocation; never throws.
   */
  write(
    table: SlotTable,
    spans: StationSpans | null,
    reveal: number,
    mix: number,
    localS: number,
    selected: number,
    colors: readonly (Color | null)[],
    consistOf: (slot: number) => Consist,
  ): void
}

function copyCars(from: ArrayLike<number>, fromSlot: number, to: Float32Array, toSlot: number): void {
  const s = fromSlot * STRIDE
  const d = toSlot * STRIDE
  for (let j = 0; j < STRIDE; j++) to[d + j] = from[s + j]!
}

/**
 * The above-veil copies of the live trains on a revealed station's platforms: the same car matrices (copied from
 * `cars`, so widening, the selected lift and the rim stay identical) in small meshes drawn after the interior.
 */
export function useSpanCars(cars: TrainCarsLayer): SpanCarsLayer {
  const bodies = useRef<InstancedMesh>(null)
  const halos = useRef<InstancedMesh>(null)
  const rims = useRef<InstancedMesh>(null)

  const layer = useMemo((): Omit<SpanCarsLayer, 'bodies' | 'halos' | 'rims'> => {
    const span: ConsistSpan = { cars: 0, pitch: 0, step: 0, rear: 0 }
    const weights = new Float64Array(MAX_CARS)
    const tint = new Color()
    const background = new Color(theme.background).convertLinearToSRGB()
    const rimColor = new Color(theme.trainSelectedRim)
    const white = new Color(1, 1, 1)
    /** Writes `color` mixed toward the background by `a` (in sRGB, as the veil blends) as instance `index`'s color. */
    const writeTint = (out: Float32Array, index: number, color: Color, a: number): void => {
      tint.copy(color)
      if (a > 0) tint.convertLinearToSRGB().lerp(background, a).convertSRGBToLinear()
      out[index * 3] = tint.r
      out[index * 3 + 1] = tint.g
      out[index * 3 + 2] = tint.b
    }
    return {
      prepare() {
        for (const m of [bodies.current, halos.current, rims.current]) {
          if (!m) continue
          m.instanceMatrix.setUsage(DynamicDrawUsage)
          m.count = 0
        }
        // Instance colors must exist before the first frame, or the shader compiles without them.
        bodies.current?.setColorAt(0, white)
        rims.current?.setColorAt(0, white)
      },
      write(table, spans, reveal, mix, localS, selected, colors, consistOf) {
        const b = bodies.current
        const h = halos.current
        const r = rims.current
        const srcB = cars.bodies.current
        const srcH = cars.halos.current
        const srcR = cars.rims.current
        if (!b || !h || !r || !srcB || !srcH || !srcR || !b.instanceColor || !r.instanceColor) return
        let n = 0
        let rimOn = false
        if (SPAN_LIFT && spans && reveal > 0) {
          const outB = b.instanceMatrix.array as Float32Array
          const outH = h.instanceMatrix.array as Float32Array
          const bodyColors = b.instanceColor.array as Float32Array
          for (let i = 0; i < table.high && n < SPAN_TRAINS; i++) {
            const g = table.drawGeometry[i]
            const color = colors[i]
            const shown = table.displayed[i]!
            if (!table.trips[i] || !g || !color || Number.isNaN(shown)) continue
            const s = spans.get(g.shapeId)
            if (!s) continue
            consistSpanInto(span, g.line.length, shown, consistOf(i), mix * slotScale(table, i, localS))
            let any = false
            for (let c = 0; c < MAX_CARS; c++) {
              weights[c] = c < span.cars ? trainSpanWeight(span.rear + (c + 0.5) * span.step, s) : 0
              if (weights[c]! > 0) any = true
            }
            if (!any) continue
            copyCars(srcB.instanceMatrix.array, i, outB, n)
            copyCars(srcH.instanceMatrix.array, i, outH, n)
            for (let c = 0; c < MAX_CARS; c++) writeTint(bodyColors, n * MAX_CARS + c, color, veilTint(reveal, weights[c]!, VEIL_TINT))
            if (i === selected) {
              copyCars(srcR.instanceMatrix.array, 0, r.instanceMatrix.array as Float32Array, 0)
              const rimColors = r.instanceColor.array as Float32Array
              for (let c = 0; c < MAX_CARS; c++) writeTint(rimColors, c, rimColor, veilTint(reveal, weights[c]!, VEIL_TINT))
              rimOn = true
            }
            n++
          }
        }
        b.count = h.count = n * MAX_CARS
        r.count = rimOn ? MAX_CARS : 0
        if (n === 0) return
        // A few KB per frame, only while trains are lifted.
        b.instanceMatrix.needsUpdate = true
        h.instanceMatrix.needsUpdate = true
        b.instanceColor.needsUpdate = true
        if (!rimOn) return
        r.instanceMatrix.needsUpdate = true
        r.instanceColor.needsUpdate = true
      },
    }
  }, [cars])

  return useMemo(() => ({ bodies, halos, rims, ...layer }), [layer])
}
