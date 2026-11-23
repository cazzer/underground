import { useEffect } from 'react'
import type { InstancedBufferAttribute } from 'three'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import type { LineBuffers } from '../lib/lineBuffers'
import type { ShapePath } from '../lib/network'
import { writePlatformFade } from '../lib/platformMask'
import type { SpanSet } from '../lib/platformSpan'
import { FADE_ATTRIBUTE } from './bandLineMaterial'

/**
 * Writes the per-vertex platform fade (platformMask.ts) of a band line layer built from `paths`, for the platform
 * spans of every drawn interior (each complex's members unioned, never across interiors; none: all zero). The band shader fades those segments by BAND_UNIFORMS.platformFade,
 * which SubwayLines sets per frame, so every band layer (the ?lines= overlays too) drops the same track.
 */
export function usePlatformFade(
  lines: LineSegments2 | null,
  buffers: LineBuffers | null,
  paths: readonly ShapePath[],
  interiorSpans: SpanSet | null,
): void {
  useEffect(() => {
    if (!lines || !buffers?.segments) return
    const fade = lines.geometry.getAttribute(FADE_ATTRIBUTE) as InstancedBufferAttribute
    writePlatformFade(fade.array as Float32Array, paths, buffers.segments, interiorSpans)
    fade.needsUpdate = true
  }, [lines, buffers, paths, interiorSpans])
}
