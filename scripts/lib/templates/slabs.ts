/** Mezzanine (or station house) slabs: one u/v rectangle per cluster of entrances along the platform. Pure.
 *  Real extents are unknown; each slab is drawn to contain every landing put on it, as L08's authored note says. */
import { roundM } from '../stationGeometry.ts'
import type { FramePoint } from '../stationInputs.ts'
import type { TemplateCtx } from './context.ts'

/** Entrances further apart than this along u feed separate slabs. */
export const CLUSTER_GAP_M = 50
/** A slab may reach this far past the ends of the platforms. */
export const SLAB_OVERHANG_M = 15
export const MIN_SLAB_M = 20
/** Every slab covers at least this much of each platform's u-range. */
export const MIN_PLATFORM_OVERLAP_M = 10
/** Across the station, a slab covers every platform plus this margin. */
const SLAB_SIDE_M = 2
/** A slab reaches out under the sidewalk toward its own entrances, at most this far past the platforms. */
export const SLAB_SIDE_MAX_M = 10

export interface SlabPlan {
  id: string
  uRange: [number, number]
  vRange: [number, number]
  /** Indices (into the entrance list given) of the entrances this slab serves. */
  entrances: number[]
}

export const slabCenter = (s: SlabPlan): FramePoint => [(s.uRange[0] + s.uRange[1]) / 2, (s.vRange[0] + s.vRange[1]) / 2]

export function slabOutline(s: SlabPlan): FramePoint[] {
  const [u0, u1] = s.uRange.map(roundM) as [number, number]
  const [v0, v1] = s.vRange.map(roundM) as [number, number]
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
}

export function inSlab(s: SlabPlan, p: FramePoint, inset = 0): boolean {
  return p[0] >= s.uRange[0] + inset && p[0] <= s.uRange[1] - inset && p[1] >= s.vRange[0] + inset && p[1] <= s.vRange[1] - inset
}

/** The point of the slab (shrunk by `inset`) nearest `p`. */
export function nearestInSlab(s: SlabPlan, p: FramePoint, inset = 0): FramePoint {
  const c = (lo: number, hi: number, x: number): number => Math.max(lo + inset, Math.min(hi - inset, x))
  return [c(s.uRange[0], s.uRange[1], p[0]), c(s.vRange[0], s.vRange[1], p[1])]
}

/** Plan distance from `p` to the slab rectangle (0 inside). */
export const slabDistance = (s: SlabPlan, p: FramePoint): number => {
  const q = nearestInSlab(s, p)
  return Math.hypot(q[0] - p[0], q[1] - p[1])
}

export function nearestSlab(slabs: readonly SlabPlan[], p: FramePoint): SlabPlan | undefined {
  return [...slabs].sort((a, b) => slabDistance(a, p) - slabDistance(b, p) || (a.id < b.id ? -1 : 1))[0]
}

/** Clusters entrances by u (split at gaps over CLUSTER_GAP_M); each cluster's u-span, at least MIN_SLAB_M long
 *  and overlapping each platform by MIN_PLATFORM_OVERLAP_M, clamped to the platforms plus SLAB_OVERHANG_M, is one
 *  slab. Across, a slab spans every platform plus SLAB_SIDE_M, widened toward its own entrances by at most
 *  SLAB_SIDE_MAX_M past the platforms (a mezzanine reaches under the sidewalk). Slabs that end up overlapping are merged.
 *  No entrances: one slab at the middle of the platforms. */
export function mezzanineSlabs(ctx: TemplateCtx, entrances: readonly FramePoint[]): SlabPlan[] {
  const [p0, p1] = ctx.uSpan
  const lo = p0 - SLAB_OVERHANG_M
  const hi = p1 + SLAB_OVERHANG_M
  const v0 = Math.min(...ctx.platforms.map((p) => p.vRange[0])) - SLAB_SIDE_M
  const v1 = Math.max(...ctx.platforms.map((p) => p.vRange[1])) + SLAB_SIDE_M
  const order = entrances.map((_, i) => i).sort((a, b) => entrances[a]![0] - entrances[b]![0] || a - b)
  const clusters: number[][] = []
  for (const i of order) {
    const last = clusters[clusters.length - 1]
    if (last && entrances[i]![0] - entrances[last[last.length - 1]!]![0] <= CLUSTER_GAP_M) last.push(i)
    else clusters.push([i])
  }
  if (clusters.length === 0) clusters.push([])

  const clamp = (u: number): number => Math.max(lo, Math.min(hi, u))
  const raw = clusters.map((members): SlabPlan => {
    const us = members.map((i) => entrances[i]![0])
    let a = members.length === 0 ? (p0 + p1) / 2 : clamp(Math.min(...us))
    let b = members.length === 0 ? (p0 + p1) / 2 : clamp(Math.max(...us))
    if (b - a < MIN_SLAB_M) {
      const mid = (a + b) / 2
      a = mid - MIN_SLAB_M / 2
      b = mid + MIN_SLAB_M / 2
      if (a < lo) [a, b] = [lo, lo + MIN_SLAB_M]
      if (b > hi) [a, b] = [hi - MIN_SLAB_M, hi]
    }
    // Overlap every platform enough for a stair and the machines to land on both.
    for (const p of ctx.platforms) {
      a = Math.min(a, p.uRange[1] - MIN_PLATFORM_OVERLAP_M)
      b = Math.max(b, p.uRange[0] + MIN_PLATFORM_OVERLAP_M)
    }
    const vs = members.map((i) => entrances[i]![1])
    const w0 = Math.max(v0 - (SLAB_SIDE_MAX_M - SLAB_SIDE_M), Math.min(v0, ...vs))
    const w1 = Math.min(v1 + (SLAB_SIDE_MAX_M - SLAB_SIDE_M), Math.max(v1, ...vs))
    return { id: '', uRange: [Math.max(lo, a), Math.min(hi, b)], vRange: [w0, w1], entrances: members }
  })
  const merged: SlabPlan[] = []
  for (const s of raw) {
    const prev = merged[merged.length - 1]
    if (prev && s.uRange[0] <= prev.uRange[1]) {
      prev.uRange = [Math.min(prev.uRange[0], s.uRange[0]), Math.max(prev.uRange[1], s.uRange[1])]
      prev.vRange = [Math.min(prev.vRange[0], s.vRange[0]), Math.max(prev.vRange[1], s.vRange[1])]
      prev.entrances.push(...s.entrances)
    } else merged.push(s)
  }
  return merged.map((s, k) => ({ ...s, id: `slab-${k + 1}`, entrances: [...s.entrances].sort((a, b) => a - b) }))
}
