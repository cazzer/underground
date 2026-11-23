/**
 * One basemap class as one LineSegments2 over a pooled buffer of segment pairs (no React). Tiles sit in the buffer in
 * the tile pool's order (src/lib/basemap/tilePool.ts): an apply rewrites and uploads only from the first tile that
 * moved, and grows the buffer (copying the kept prefix) only when the segments outgrow it. A buffer that stays under a
 * quarter full for SHRINK_AFTER_S shrinks (copying the live range), so the city view's large pools don't stay
 * allocated at a station. The stroke fades by mixing its color toward the background, never by opacity, so a line
 * is opaque wherever it is not masked or fading out at the basemap's extent. Transparent with depthTest and depthWrite off, like
 * every overlay: the depth-tested car bodies rely on nothing before them writing depth (cars on a station ramp run
 * below the street).
 */
import { Color, DynamicDrawUsage, type InterleavedBuffer, type InterleavedBufferAttribute } from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { BasemapLineMaterial, type ExtentUniforms, type MaskUniforms } from './basemapLineMaterial'

/** The first buffer's capacity, in segments, and the smallest it shrinks to. */
export const INITIAL_SEGMENTS = 1024
/** A buffer under a quarter full this long (seconds) shrinks to the next power of two of 1.25x its use. */
export const SHRINK_AFTER_S = 2
/** Floats per segment: two xyz ends. */
const STRIDE = 6

export interface ClassLayerOptions {
  /** CSS px. */
  width: number
  renderOrder: number
  /** Shared by the road classes; water and parks pass their own, never written (strength 0). */
  mask: MaskUniforms
  extent: ExtentUniforms
}

export interface ClassLayer {
  readonly line: LineSegments2
  /** Segments drawn. */
  readonly used: number
  /** Segments the buffer holds. */
  readonly capacity: number
  /**
   * Writes the tiles in `order`, reusing the first `keep` (they sit where the previous apply put them).
   * `segmentsOf` gives a tile's segments for this class, or undefined for none.
   */
  apply(order: readonly number[], keep: number, segmentsOf: (key: number) => Float32Array | undefined): void
  /** Once per frame, `nowS` in seconds: shrinks a buffer that has stayed under a quarter full. Allocates only then. */
  tick(nowS: number): void
  /**
   * Mixes the stroke `v` (0..1) of the way from `background` to `stroke` (linear, both linear colors), then `dim` (0..1)
   * of the way back to the background in sRGB, as the route lines dim under a trip (DIM_GLSL); hidden at v 0 or with
   * nothing to draw.
   */
  setVisibility(v: number, stroke: Color, background: Color, dim?: number): void
  dispose(): void
}

function pooledGeometry(capacity: number): LineSegmentsGeometry {
  const g = new LineSegmentsGeometry().setPositions(new Float32Array(capacity * STRIDE))
  pooledBuffer(g).setUsage(DynamicDrawUsage)
  g.instanceCount = 0
  return g
}

function pooledBuffer(g: LineSegmentsGeometry): InterleavedBuffer {
  return (g.getAttribute('instanceStart') as InterleavedBufferAttribute).data
}

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 1)))
/** The capacity for `need` segments: room to grow by a quarter, never under the start. */
const capacityFor = (need: number) => Math.max(INITIAL_SEGMENTS, nextPow2(Math.ceil(need * 1.25)))

export function createClassLayer({ width, renderOrder, mask, extent }: ClassLayerOptions): ClassLayer {
  const material = new BasemapLineMaterial(mask, extent, { linewidth: width, transparent: true, depthTest: false, depthWrite: false })
  let capacity = INITIAL_SEGMENTS
  const line = new LineSegments2(pooledGeometry(capacity), material)
  line.renderOrder = renderOrder
  // Absolute scene meters across the whole city: the bounding sphere of a pooled buffer means nothing.
  line.frustumCulled = false
  line.visible = false
  /** ends[i]: the segment count through order[i] after the last apply. */
  const ends: number[] = []
  let used = 0
  let strength = 0
  /** When the buffer last fell under a quarter full, or -1 while it isn't. */
  let lowSince = -1
  /** Scratch: the background in sRGB for the dim. */
  const backgroundSrgb = new Color()

  const showIfDrawn = () => {
    line.visible = strength > 0 && used > 0
  }

  /** Swaps in a buffer of `next` segments holding the first `kept` of the current one. */
  function resize(next: number, kept: number): void {
    const old = line.geometry
    capacity = next
    const g = pooledGeometry(capacity)
    pooledBuffer(g).array.set((pooledBuffer(old).array as Float32Array).subarray(0, kept * STRIDE))
    g.instanceCount = used
    line.geometry = g
    old.dispose()
  }

  return {
    line,
    get used() {
      return used
    },
    get capacity() {
      return capacity
    },
    apply(order, keep, segmentsOf) {
      const start = keep > 0 ? ends[keep - 1]! : 0
      let need = start
      for (let i = keep; i < order.length; i++) need += (segmentsOf(order[i]!)?.length ?? 0) / STRIDE
      const grew = need > capacity
      if (grew) resize(capacityFor(need), start)
      const buffer = pooledBuffer(line.geometry)
      const array = buffer.array as Float32Array
      let at = start
      ends.length = order.length
      for (let i = keep; i < order.length; i++) {
        const segs = segmentsOf(order[i]!)
        if (segs) {
          array.set(segs, at * STRIDE)
          at += segs.length / STRIDE
        }
        ends[i] = at
      }
      used = need
      line.geometry.instanceCount = used
      if (!grew && need > start) {
        // A hidden layer isn't rendered, so its last range may not be uploaded yet: widen it rather than drop it.
        const pending = buffer.updateRanges[0]
        const from = pending ? Math.min(pending.start, start * STRIDE) : start * STRIDE
        buffer.clearUpdateRanges()
        buffer.addUpdateRange(from, need * STRIDE - from)
        buffer.needsUpdate = true
      }
      showIfDrawn()
    },
    tick(nowS) {
      if (capacity <= INITIAL_SEGMENTS || used >= capacity / 4) {
        lowSince = -1
        return
      }
      if (lowSince < 0) lowSince = nowS
      else if (nowS - lowSince >= SHRINK_AFTER_S) {
        lowSince = -1
        resize(capacityFor(used), used)
      }
    },
    setVisibility(v, stroke, background, dim = 0) {
      strength = v
      material.color.lerpColors(background, stroke, v)
      if (dim > 0) material.color.convertLinearToSRGB().lerp(backgroundSrgb.copy(background).convertLinearToSRGB(), dim).convertSRGBToLinear()
      showIfDrawn()
    },
    dispose() {
      line.geometry.dispose()
      material.dispose()
    },
  }
}
