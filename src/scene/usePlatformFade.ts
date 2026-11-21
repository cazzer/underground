import { useEffect } from 'react'
import type { InstancedBufferAttribute } from 'three'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import type { StationId } from '../data/schema'
import type { LineBuffers } from '../lib/lineBuffers'
import type { Network, ShapePath } from '../lib/network'
import { writePlatformFade } from '../lib/platformMask'
import { FADE_ATTRIBUTE } from './bandLineMaterial'

/**
 * Writes the per-vertex platform fade (platformMask.ts) of a band line layer built from `paths`, for the station
 * whose interior is loaded (none: all zero). The band shader fades those segments by BAND_UNIFORMS.platformFade,
 * which SubwayLines sets per frame, so every band layer (the ?lines= overlays too) drops the same track.
 */
export function usePlatformFade(
  lines: LineSegments2 | null,
  buffers: LineBuffers | null,
  paths: readonly ShapePath[],
  network: Network,
  interiorStationId: StationId | null,
): void {
  useEffect(() => {
    if (!lines || !buffers?.firstSegment) return
    const fade = lines.geometry.getAttribute(FADE_ATTRIBUTE) as InstancedBufferAttribute
    const spans = (interiorStationId !== null && network.platformSpans.get(interiorStationId)) || null
    writePlatformFade(fade.array as Float32Array, paths, buffers.firstSegment, spans)
    fade.needsUpdate = true
  }, [lines, buffers, paths, network, interiorStationId])
}
