/** Island or side platform, and how many tracks, from platform polygons and track centerlines.
 *  Each polygon is cut across the station axis at five places; at each cut a platform is an island when
 *  a track runs beside both long edges and a side platform when one does. The cuts vote. */
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import { SECTION_FRACTIONS, buildSections } from './crossSection.ts'
import type { Crossing, Section, SectionInterval, UVTrack } from './crossSection.ts'
import { FALLBACK_CAP, geometryOnlyLayout } from './platformFallback.ts'
import { fromUV, stationAxis, toUV } from './platformAxis.ts'
import type { AxisFrame, UV } from './platformAxis.ts'
import type { LayoutAnalysis, PlatformLayout } from './platformLayout.ts'
import type { PlatformFact, TrackFact } from './stationFacts.ts'

export type { LayoutAnalysis, PlatformLayout } from './platformLayout.ts'

const MAX_AXIS_DEVIATION_DEG = 20
const TRACK_NEAR_PLATFORM_M = 60
/** A track beside an edge sits from this far inside it to this far outside it. */
const EDGE_INSIDE_M = 1.5
const EDGE_OUTSIDE_M = 5
const TRACK_SPAN_MARGIN_M = 5
const AGREE_PENALTY_BELOW = 0.8
const AGREE_CAP_BELOW = 0.6
const AGREE_CAP = 0.4
const WIDTH_PRIOR_M = { island: [5, 15], side: [2.5, 8] } as const

type EdgeHit = { side: -1 | 1; v: number; ref: string }
interface SectionRec {
  group: number
  kind: 'island' | 'side' | 'orphan' | 'dropped'
  v0: number
  v1: number
  edges: EdgeHit[]
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[(s.length - 1) >> 1]!
}

function distanceToPath(p: LocalPoint, path: LocalPoint[]): number {
  let best = Infinity
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz))
  }
  return best
}

function centroid(ring: LocalPoint[]): LocalPoint {
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
}

function nearest(cs: Crossing[], v: number): Crossing | undefined {
  return cs.reduce<Crossing | undefined>((best, c) => (best === undefined || Math.abs(c.v - v) < Math.abs(best.v - v) ? c : best), undefined)
}

/** Classifies one merged interval; a track drawn inside the polygon voids it. */
function classify(iv: SectionInterval, crossings: Crossing[], group: number, u: number, reasons: Set<string>): SectionRec {
  const rec = { group, v0: iv.v0, v1: iv.v1 }
  const inside = crossings.find((c) => c.v > iv.v0 + EDGE_INSIDE_M && c.v < iv.v1 - EDGE_INSIDE_M)
  if (inside) {
    reasons.add(`track ${inside.ref} drawn inside a platform polygon (u ${u.toFixed(0)} m); that section is ignored for the platform`)
    return { ...rec, kind: 'dropped', edges: [] }
  }
  const right = nearest(crossings.filter((c) => c.v >= iv.v1 - EDGE_INSIDE_M && c.v <= iv.v1 + EDGE_OUTSIDE_M), iv.v1)
  const left = nearest(crossings.filter((c) => c.v >= iv.v0 - EDGE_OUTSIDE_M && c.v <= iv.v0 + EDGE_INSIDE_M), iv.v0)
  const edges: EdgeHit[] = []
  if (left) edges.push({ side: -1, v: left.v, ref: left.ref })
  if (right) edges.push({ side: 1, v: right.v, ref: right.ref })
  return { ...rec, kind: edges.length === 2 ? 'island' : edges.length === 1 ? 'side' : 'orphan', edges }
}

function mostCommon(xs: string[]): string {
  const counts = new Map<string, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
}

class Groups {
  private readonly parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]!]!
    return i
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b)
  }
}

/** Track count and positions: crossings within a margin of the platforms, median over the cuts. */
function trackSpan(sections: Section[]): { count: number; offsets: number[] } {
  const spans = sections
    .filter((s) => s.intervals.length > 0)
    .map((s) => {
      const lo = Math.min(...s.intervals.map((i) => i.v0)) - TRACK_SPAN_MARGIN_M
      const hi = Math.max(...s.intervals.map((i) => i.v1)) + TRACK_SPAN_MARGIN_M
      return s.crossings.filter((c) => c.v >= lo && c.v <= hi).map((c) => c.v)
    })
  if (spans.length === 0) return { count: 0, offsets: [] }
  const count = median(spans.map((s) => s.length))
  return { count, offsets: spans.find((s) => s.length === count)! }
}

export function analyzePlatforms(platforms: PlatformFact[], tracks: TrackFact[]): LayoutAnalysis {
  const reasons: string[] = []
  let penalty = 0
  let cap = 1
  const axis = stationAxis(platforms.map((p) => p.outline))
  const bbox = platforms.flatMap((p) => p.outline.map((pt) => toUV(pt, { bearingDeg: axis.bearingDeg, origin: [0, 0] })))
  const mid = (i: 0 | 1): number => (Math.min(...bbox.map((p) => p[i])) + Math.max(...bbox.map((p) => p[i]))) / 2
  const center = fromUV([mid(0), mid(1)], { bearingDeg: axis.bearingDeg, origin: [0, 0] })
  const frame: AxisFrame = { bearingDeg: axis.bearingDeg, origin: center }
  const base = { bearingDeg: axis.bearingDeg, center }

  if (axis.deviationsDeg.some((d) => d > MAX_AXIS_DEVIATION_DEG)) {
    penalty += 0.3
    reasons.push(`a platform axis is more than ${MAX_AXIS_DEVIATION_DEG} degrees off the station axis (curved or crossing platforms): -0.3`)
  }
  const rings: UV[][] = platforms.map((p) => p.outline.map((pt) => toUV(pt, frame)))
  const ways = platforms.map((p) => p.osmWay)

  const tracksNear = platforms.some((p) => tracks.some((t) => distanceToPath(centroid(p.outline), t.path) <= TRACK_NEAR_PLATFORM_M))
  if (!tracksNear) {
    const f = geometryOnlyLayout(rings, ways)
    reasons.push(`no track within ${TRACK_NEAR_PLATFORM_M} m of any platform: ${f.reason}`)
    return { ...base, platformType: f.platformType, trackCount: f.trackCount, trackOffsetsV: f.trackOffsetsV, layouts: f.layouts, penalty, cap: Math.min(cap, FALLBACK_CAP), reasons, geometryOnly: true }
  }

  const uvTracks: UVTrack[] = tracks.map((t) => ({ ref: t.ref, pts: t.path.map((pt) => toUV(pt, frame)) }))
  const sections = buildSections(rings, uvTracks, SECTION_FRACTIONS)
  const groups = new Groups(platforms.length)
  for (const s of sections) for (const iv of s.intervals) for (const p of iv.platforms) groups.union(p, iv.platforms[0]!)

  const noted = new Set<string>()
  const recs = sections.flatMap((s) => s.intervals.map((iv) => classify(iv, s.crossings, groups.find(iv.platforms[0]!), s.u, noted)))
  reasons.push(...noted)
  if (sections.some((s) => s.gapWithoutTrack)) {
    penalty += 0.2
    reasons.push('two platform polygons at least 4 m apart with no track between them: -0.2')
  }

  const layouts: PlatformLayout[] = []
  for (const g of new Set(platforms.map((_, i) => groups.find(i)))) {
    const members = platforms.map((_, i) => i).filter((i) => groups.find(i) === g)
    const wayList = members.map((i) => ways[i]!).sort((a, b) => a - b)
    const mine = recs.filter((r) => r.group === g)
    const valid = mine.filter((r) => r.kind === 'island' || r.kind === 'side')
    if (valid.length === 0) {
      if (mine.some((r) => r.kind === 'orphan')) {
        penalty += 0.3
        reasons.push(`platform ${wayList.join('+')} has no track beside either edge (orphan): -0.3`)
      } else reasons.push(`platform ${wayList.join('+')} is not used: ${mine.length === 0 ? 'no cross-section reaches it' : 'its sections were dropped'}`)
      continue
    }
    const islands = valid.filter((r) => r.kind === 'island').length
    const kind = islands > valid.length - islands ? 'island' : 'side'
    const agreement = Math.max(islands, valid.length - islands) / (valid.length + mine.filter((r) => r.kind === 'orphan').length)
    if (agreement < AGREE_PENALTY_BELOW) {
      penalty += 0.2
      reasons.push(`platform ${wayList.join('+')}: only ${(agreement * 100).toFixed(0)}% of cross-sections agree on ${kind}: -0.2`)
    }
    if (agreement < AGREE_CAP_BELOW) {
      cap = Math.min(cap, AGREE_CAP)
      reasons.push(`platform ${wayList.join('+')}: cross-sections disagree; confidence capped at ${AGREE_CAP}`)
    }
    const agreeing = valid.filter((r) => r.kind === kind)
    const edges = ([-1, 1] as const).flatMap((side) => {
      const hits = agreeing.flatMap((r) => r.edges.filter((e) => e.side === side))
      return hits.length === 0 ? [] : [{ side, offsetV: median(hits.map((h) => h.v)), trackRef: mostCommon(hits.map((h) => h.ref)) }]
    })
    const us = members.flatMap((i) => rings[i]!.map((p) => p[0]))
    layouts.push({
      osmWays: wayList,
      kind,
      centerV: median(agreeing.map((r) => (r.v0 + r.v1) / 2)),
      widthM: median(agreeing.map((r) => r.v1 - r.v0)),
      uRange: [Math.min(...us), Math.max(...us)],
      edges,
    })
  }

  const { count, offsets } = trackSpan(sections)
  const meanV = offsets.length === 0 ? 0 : offsets.reduce((s, v) => s + v, 0) / offsets.length
  for (const l of layouts) {
    const [lo, hi] = WIDTH_PRIOR_M[l.kind]
    if (l.widthM < lo || l.widthM > hi) {
      penalty += 0.1
      reasons.push(`platform ${l.osmWays.join('+')} is ${l.widthM.toFixed(1)} m wide, outside the usual ${lo}-${hi} m for a ${l.kind} platform: -0.1`)
    }
    const edge = l.edges[0]
    if (l.kind === 'side' && edge && offsets.length > 0 && Math.abs(l.centerV - meanV) > 1 && edge.side === (l.centerV < meanV ? -1 : 1)) {
      penalty += 0.3
      reasons.push(`side platform ${l.osmWays.join('+')} has its track on the side away from the other tracks: -0.3`)
    }
  }
  const kinds = new Set(layouts.map((l) => l.kind))
  const platformType = kinds.size === 0 ? null : kinds.size === 2 ? 'mixed' : [...kinds][0]!
  return { ...base, platformType, trackCount: count, trackOffsetsV: [...offsets].sort((a, b) => a - b), layouts, penalty, cap, reasons, geometryOnly: false }
}
