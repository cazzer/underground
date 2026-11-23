/**
 * Along a revealed station's platforms the interior draws its own track a meter or so beside the map's, so the
 * map track there fades out: each route-line segment end carries a fade weight (maskSpanWeight, 1 inside the
 * platform, easing to 0 at its ends), and the band line shader multiplies the line's alpha by
 * 1 - weight * reveal. The weights live in the merged route lines' own buffers, so the fade moves with the band
 * offset. Pure.
 */
import type { ShapeId } from '../data/schema'
import type { ShapePath } from './network'
import { MASK_INSET_M, maskWeightIn, type PlatformSpan, type SpanSet } from './platformSpan'

/**
 * Vertex spacing along each end ramp of a span. The shader interpolates the fade linearly between vertices, so one
 * chord per ramp (the ramp's full length) strays under 0.1 in weight from the eased fade and costs two vertices per span.
 */
const RAMP_STEP_M = MASK_INSET_M

/** Distances the drawn line needs vertices at for a span's fade: both ends and each ramp's inner end. */
export function maskBreaks(span: PlatformSpan): number[] {
  const out: number[] = []
  for (let d = 0; d <= MASK_INSET_M; d += RAMP_STEP_M) out.push(span.d0 + d, span.d1 - d)
  return out.filter((d) => d >= span.d0 && d <= span.d1).sort((a, b) => a - b)
}

/** Floats per segment in the fade buffer: the weight at its start and at its end. */
export const FADE_INPUTS = 2

/**
 * Writes the fade weights of `spans` (the drawn interiors', or null for none; each segment end takes its highest weight
 * over the shape's spans) into `fade`, laid out like the line buffers
 * (`segments.get(id)[i - 1]` is the buffer segment joining points i - 1 and i of shape `id`, -1 when it isn't
 * drawn). Every other segment gets 0.
 */
export function writePlatformFade(
  fade: Float32Array,
  paths: readonly ShapePath[],
  segments: ReadonlyMap<ShapeId, Int32Array>,
  spans: SpanSet | null,
): void {
  fade.fill(0)
  if (!spans) return
  for (const path of paths) {
    const list = spans.get(path.id)
    const of = segments.get(path.id)
    if (!list || !of) continue
    for (let i = 1; i < path.points.length; i++) {
      const seg = of[i - 1]!
      if (seg < 0) continue
      const o = seg * FADE_INPUTS
      fade[o] = maskWeightIn(path.cumulative[i - 1]!, list)
      fade[o + 1] = maskWeightIn(path.cumulative[i]!, list)
    }
  }
}
