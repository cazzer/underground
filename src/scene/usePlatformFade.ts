import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { InstancedBufferAttribute } from 'three'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import type { LineBuffers } from '../lib/lineBuffers'
import type { ShapePath } from '../lib/network'
import { FADE_INPUTS, writePlatformFade, writeShapeFade } from '../lib/platformMask'
import type { ShownSpan, SpanPresence, SpanSet } from '../lib/platformSpan'
import { FADE_ATTRIBUTE } from './bandLineMaterial'

/** The shapes the spans touch with their buffer segments, the presences on them and the upload range of each shape. */
interface Touched {
  paths: ShapePath[]
  of: Int32Array[]
  lists: (readonly ShownSpan[])[]
  ranges: { start: number; count: number }[]
  presences: SpanPresence[]
  /** Each presence's value at the last write. */
  last: Float32Array
}

function touchedBy(paths: readonly ShapePath[], segments: ReadonlyMap<string, Int32Array>, spans: SpanSet): Touched {
  const t: Touched = { paths: [], of: [], lists: [], ranges: [], presences: [], last: new Float32Array(0) }
  for (const path of paths) {
    const list = spans.get(path.id)
    const of = segments.get(path.id)
    if (!list || !of) continue
    let lo = Infinity
    let hi = -1
    for (const seg of of) {
      if (seg < 0) continue
      lo = Math.min(lo, seg)
      hi = Math.max(hi, seg)
    }
    if (hi < 0) continue
    t.paths.push(path)
    t.of.push(of)
    t.lists.push(list)
    t.ranges.push({ start: lo * FADE_INPUTS, count: (hi - lo + 1) * FADE_INPUTS })
    for (const s of list) if (!t.presences.includes(s.presence)) t.presences.push(s.presence)
  }
  t.last = Float32Array.from(t.presences, (p) => p.value)
  return t
}

/**
 * Writes the per-vertex platform fade (platformMask.ts) of a band line layer built from `paths`, for the platform
 * spans of every drawn interior (each complex's members unioned, never across interiors; none: all zero), each at its
 * interior's presence. The band shader fades those segments by BAND_UNIFORMS.platformFade, which SubwayLines sets per
 * frame, so every band layer (the ?lines= overlays too) drops the same track. While a presence changes (an interior
 * easing in or out) a frame rewrites only the shapes the spans touch and uploads only their ranges; with every
 * presence still, nothing. No allocation per frame.
 */
export function usePlatformFade(
  lines: LineSegments2 | null,
  buffers: LineBuffers | null,
  paths: readonly ShapePath[],
  interiorSpans: SpanSet | null,
): void {
  const touched = useMemo(
    () => (buffers?.segments && interiorSpans ? touchedBy(paths, buffers.segments, interiorSpans) : null),
    [buffers, paths, interiorSpans],
  )
  /** A whole-buffer write waits for upload: a frame's ranges would cut it down to theirs. */
  const fullPending = useRef(false)
  useEffect(() => {
    if (!lines || !buffers?.segments) return
    fullPending.current = true
    const fade = lines.geometry.getAttribute(FADE_ATTRIBUTE) as InstancedBufferAttribute
    writePlatformFade(fade.array as Float32Array, paths, buffers.segments, interiorSpans)
    if (touched) touched.presences.forEach((p, k) => (touched.last[k] = p.value))
    fade.needsUpdate = true
  }, [lines, buffers, paths, interiorSpans, touched])

  useFrame(() => {
    const full = fullPending.current
    fullPending.current = false
    if (!lines || !touched) return
    let moved = false
    for (let k = 0; k < touched.presences.length; k++) {
      const v = touched.presences[k]!.value
      if (v === touched.last[k]) continue
      touched.last[k] = v
      moved = true
    }
    if (!moved) return
    const fade = lines.geometry.getAttribute(FADE_ATTRIBUTE) as InstancedBufferAttribute
    const array = fade.array as Float32Array
    for (let i = 0; i < touched.paths.length; i++) {
      writeShapeFade(array, touched.paths[i]!, touched.of[i]!, touched.lists[i]!)
      if (!full) fade.updateRanges.push(touched.ranges[i]!)
    }
    fade.needsUpdate = true
  })
}
