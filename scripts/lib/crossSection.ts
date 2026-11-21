/** Cross-sections of a station perpendicular to its axis: where tracks cross a line of constant u,
 *  and which v-intervals the platform polygons cover there. All inputs are in [u, v]. */
import type { UV } from './platformAxis.ts'

export const SECTION_FRACTIONS = [0.15, 0.3, 0.5, 0.7, 0.85]
/** Only track segments within this angle of the axis count; a steep crossing ramp is ignored. */
const MAX_TRACK_ANGLE_DEG = 30
const MAX_ABS_V_M = 40
const DEDUPE_M = 1.5
/** Intervals closer than this with no track between them are one platform (split islands, OSM slop). */
export const MERGE_GAP_M = 4
const BLOCK_SLACK_M = 0.25

export interface UVTrack {
  ref: string
  pts: UV[]
}
export interface Crossing {
  v: number
  ref: string
}
export interface SectionInterval {
  v0: number
  v1: number
  /** Indexes into the platform list. */
  platforms: number[]
}
export interface Section {
  u: number
  crossings: Crossing[]
  intervals: SectionInterval[]
  /** Two neighbouring intervals at least MERGE_GAP_M apart with no track between them. */
  gapWithoutTrack: boolean
}

export function trackCrossings(tracks: UVTrack[], u0: number): Crossing[] {
  const tan = Math.tan((MAX_TRACK_ANGLE_DEG * Math.PI) / 180)
  const found: Crossing[] = []
  for (const t of tracks) {
    for (let i = 0; i + 1 < t.pts.length; i++) {
      const a = t.pts[i]!
      const b = t.pts[i + 1]!
      if (a[0] <= u0 === b[0] <= u0) continue
      if (Math.abs(b[1] - a[1]) > tan * Math.abs(b[0] - a[0])) continue
      const v = a[1] + ((u0 - a[0]) / (b[0] - a[0])) * (b[1] - a[1])
      if (Math.abs(v) <= MAX_ABS_V_M) found.push({ v, ref: t.ref })
    }
  }
  found.sort((x, y) => x.v - y.v)
  const kept: Crossing[] = []
  for (const c of found) if (kept.length === 0 || c.v - kept[kept.length - 1]!.v >= DEDUPE_M) kept.push(c)
  return kept
}

/** Even-odd intervals of the polygon along the line u = u0. */
export function polygonIntervals(ring: UV[], u0: number): [number, number][] {
  const vs: number[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    if (a[0] <= u0 === b[0] <= u0) continue
    vs.push(a[1] + ((u0 - a[0]) / (b[0] - a[0])) * (b[1] - a[1]))
  }
  vs.sort((x, y) => x - y)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < vs.length; i += 2) out.push([vs[i]!, vs[i + 1]!])
  return out
}

/** Merges neighbouring intervals that are closer than MERGE_GAP_M with no track crossing between them. */
export function mergeIntervals(raw: SectionInterval[], crossings: Crossing[]): { intervals: SectionInterval[]; gapWithoutTrack: boolean } {
  const sorted = [...raw].sort((a, b) => a.v0 - b.v0)
  const out: SectionInterval[] = []
  let gapWithoutTrack = false
  for (const next of sorted) {
    const cur = out[out.length - 1]
    if (!cur) {
      out.push({ ...next, platforms: [...next.platforms] })
      continue
    }
    const lo = Math.min(cur.v1, next.v0) - BLOCK_SLACK_M
    const hi = Math.max(cur.v1, next.v0) + BLOCK_SLACK_M
    const blocked = crossings.some((c) => c.v >= lo && c.v <= hi)
    if (next.v0 - cur.v1 < MERGE_GAP_M && !blocked) {
      cur.v1 = Math.max(cur.v1, next.v1)
      cur.platforms.push(...next.platforms)
    } else {
      if (!blocked) gapWithoutTrack = true
      out.push({ ...next, platforms: [...next.platforms] })
    }
  }
  return { intervals: out, gapWithoutTrack }
}

export function buildSections(rings: UV[][], tracks: UVTrack[], fractions: number[] = SECTION_FRACTIONS): Section[] {
  const us = rings.flatMap((r) => r.map((p) => p[0]))
  const uMin = Math.min(...us)
  const uMax = Math.max(...us)
  return fractions.map((f) => {
    const u = uMin + f * (uMax - uMin)
    const crossings = trackCrossings(tracks, u)
    const raw = rings.flatMap((ring, i) => polygonIntervals(ring, u).map(([v0, v1]): SectionInterval => ({ v0, v1, platforms: [i] })))
    const { intervals, gapWithoutTrack } = mergeIntervals(raw, crossings)
    return { u, crossings, intervals, gapWithoutTrack }
  })
}
