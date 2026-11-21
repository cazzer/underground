/** Island/side guess from platform polygons alone, for stations with no usable track geometry.
 *  The caller caps the confidence; the track positions here are estimates, not evidence. */
import { buildSections } from './crossSection.ts'
import type { PlatformLayout } from './platformLayout.ts'
import type { UV } from './platformAxis.ts'

const MIN_ISLAND_WIDTH_M = 5
const MIN_SIDE_SEPARATION_M = 6
/** Estimated distance from a platform edge to its track. */
const EDGE_TO_TRACK_M = 1.7
export const FALLBACK_CAP = 0.5

export interface Fallback {
  layouts: PlatformLayout[]
  platformType: 'island' | 'side' | null
  trackCount: number
  trackOffsetsV: number[]
  reason: string
}

function uRangeOf(rings: UV[][], idx: number[]): [number, number] {
  const us = idx.flatMap((i) => rings[i]!.map((p) => p[0]))
  return [Math.min(...us), Math.max(...us)]
}

export function geometryOnlyLayout(rings: UV[][], ways: number[]): Fallback {
  const intervals = buildSections(rings, [], [0.5], false)[0]!.intervals
  const make = (iv: { v0: number; v1: number; platforms: number[] }, kind: 'island' | 'side', edgeSides: (-1 | 1)[]): PlatformLayout => ({
    osmWays: iv.platforms.map((i) => ways[i]!).sort((a, b) => a - b),
    kind,
    centerV: (iv.v0 + iv.v1) / 2,
    widthM: iv.v1 - iv.v0,
    uRange: uRangeOf(rings, iv.platforms),
    edges: edgeSides.map((side) => ({ side, offsetV: side > 0 ? iv.v1 + EDGE_TO_TRACK_M : iv.v0 - EDGE_TO_TRACK_M, trackRef: 'estimated' })),
  })
  const [a, b] = intervals
  if (a && !b && a.v1 - a.v0 >= MIN_ISLAND_WIDTH_M) {
    const layout = make(a, 'island', [-1, 1])
    return { layouts: [layout], platformType: 'island', trackCount: 2, trackOffsetsV: layout.edges.map((e) => e.offsetV), reason: 'one merged polygon at least 5 m wide read as an island; tracks estimated' }
  }
  // Two polygons both wide enough to be islands are ambiguous, not side platforms.
  const bothWide = a !== undefined && b !== undefined && a.v1 - a.v0 >= MIN_ISLAND_WIDTH_M && b.v1 - b.v0 >= MIN_ISLAND_WIDTH_M
  if (a && b && !intervals[2] && !bothWide && b.v0 - a.v1 >= MIN_SIDE_SEPARATION_M) {
    const layouts = [make(a, 'side', [1]), make(b, 'side', [-1])]
    return { layouts, platformType: 'side', trackCount: 2, trackOffsetsV: layouts.flatMap((l) => l.edges.map((e) => e.offsetV)), reason: 'two parallel polygons at least 6 m apart read as side platforms; tracks estimated' }
  }
  return { layouts: [], platformType: null, trackCount: 0, trackOffsetsV: [], reason: 'polygons alone show neither an island (one polygon 5 m or wider) nor two narrow side platforms (6 m apart)' }
}
