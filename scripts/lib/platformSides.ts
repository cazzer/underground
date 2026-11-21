/** Island or side platform, and how many tracks, from platform polygons and track centerlines.
 *  Each polygon is cut across the station axis at several places (fractions of the whole station and of
 *  each platform); at each cut a platform is an island when a track runs beside both long edges and a side
 *  platform when one does. The cuts vote. */
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import { buildSections } from './crossSection.ts'
import type { UVTrack } from './crossSection.ts'
import { FALLBACK_CAP, geometryOnlyLayout } from './platformFallback.ts'
import { fromUV, stationAxis, toUV } from './platformAxis.ts'
import type { AxisFrame, UV } from './platformAxis.ts'
import { capAt, deduct, newLedger } from './platformLayout.ts'
import type { LayoutAnalysis } from './platformLayout.ts'
import { Groups, buildLayouts, classifySection, joinSplitPlatforms } from './platformVote.ts'
import { trackSpan } from './trackSpan.ts'
import type { PlatformFact, TrackFact } from './stationFacts.ts'
import { distanceToSegment } from './stationGeometry.ts'

export type { LayoutAnalysis, PlatformLayout } from './platformLayout.ts'

const MAX_AXIS_DEVIATION_DEG = 20
const TRACK_NEAR_PLATFORM_M = 60
const WIDTH_PRIOR_M = { island: [5, 15], side: [2.5, 8] } as const
/** How far a platform center or a track may wander in v across the cuts before the station reads as curved.
 *  A straight station wanders by centimeters; 1 degree of skew over a 150 m platform is about 2.6 m. */
const SPREAD_PENALTY_M = 1
const SPREAD_CAP_M = 3
const SPREAD_CAP = 0.5
/** Side platforms come one per direction; a lone one with 2 or more tracks around it (the other platform
 *  missing from the data) puts the station below the interior bar. Park Pl and Aqueduct really have one. */
const LONE_SIDE_CAP = 0.6

function distanceToPath(p: LocalPoint, path: LocalPoint[]): number {
  let best = Infinity
  for (let i = 0; i + 1 < path.length; i++) best = Math.min(best, distanceToSegment(p, path[i]!, path[i + 1]!))
  return best
}

function centroid(ring: LocalPoint[]): LocalPoint {
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
}

export function analyzePlatforms(platforms: PlatformFact[], tracks: TrackFact[]): LayoutAnalysis {
  const ledger = newLedger()
  const axis = stationAxis(platforms.map((p) => p.outline))
  const bbox = platforms.flatMap((p) => p.outline.map((pt) => toUV(pt, { bearingDeg: axis.bearingDeg, origin: [0, 0] })))
  const mid = (i: 0 | 1): number => (Math.min(...bbox.map((p) => p[i])) + Math.max(...bbox.map((p) => p[i]))) / 2
  const center = fromUV([mid(0), mid(1)], { bearingDeg: axis.bearingDeg, origin: [0, 0] })
  const frame: AxisFrame = { bearingDeg: axis.bearingDeg, origin: center }
  const base = { bearingDeg: axis.bearingDeg, center }
  const done = (r: Omit<LayoutAnalysis, 'bearingDeg' | 'center' | 'penalty' | 'cap' | 'reasons'>): LayoutAnalysis => ({ ...base, ...r, penalty: ledger.penalty, cap: ledger.cap, reasons: ledger.reasons })

  if (axis.deviationsDeg.some((d) => d > MAX_AXIS_DEVIATION_DEG)) {
    deduct(ledger, 0.3, `a platform axis is more than ${MAX_AXIS_DEVIATION_DEG} degrees off the station axis (curved or crossing platforms)`)
  }
  const rings: UV[][] = platforms.map((p) => p.outline.map((pt) => toUV(pt, frame)))
  const ways = platforms.map((p) => p.osmWay)

  const tracksNear = platforms.some((p) => tracks.some((t) => distanceToPath(centroid(p.outline), t.path) <= TRACK_NEAR_PLATFORM_M))
  if (!tracksNear) {
    const f = geometryOnlyLayout(rings, ways)
    ledger.reasons.push(`no track within ${TRACK_NEAR_PLATFORM_M} m of any platform: ${f.reason}`)
    ledger.cap = Math.min(ledger.cap, FALLBACK_CAP)
    return done({ platformType: f.platformType, trackCount: f.trackCount, trackOffsetsV: f.trackOffsetsV, layouts: f.layouts, geometryOnly: true })
  }

  const uvTracks: UVTrack[] = tracks.map((t) => ({ ref: t.ref, pts: t.path.map((pt) => toUV(pt, frame)), service: t.service === true }))
  const sections = buildSections(rings, uvTracks)
  const groups = new Groups(platforms.length)
  joinSplitPlatforms(rings, groups)
  for (const s of sections) for (const iv of s.intervals) for (const p of iv.platforms) groups.union(p, iv.platforms[0]!)

  const notes = new Set<string>()
  const recs = sections.flatMap((s) => s.intervals.map((iv) => classifySection(iv, s.crossings, groups.find(iv.platforms[0]!), s.u, notes)))
  ledger.reasons.push(...notes)
  if (sections.some((s) => s.gapWithoutTrack)) deduct(ledger, 0.2, 'two platform polygons at least 4 m apart with no track between them')

  const { layouts, spreadM: centerSpread, keptGroups } = buildLayouts(ways, rings, recs, groups, ledger)
  const span = trackSpan(sections, (iv) => keptGroups.has(groups.find(iv.platforms[0]!)))
  if (span.note) ledger.reasons.push(span.note)
  const spread = Math.max(centerSpread, span.spreadM)
  if (spread > SPREAD_PENALTY_M) deduct(ledger, 0.2, `platform centers or tracks wander ${spread.toFixed(1)} m across the station (curved or skewed)`)
  if (spread > SPREAD_CAP_M) capAt(ledger, SPREAD_CAP, `platforms are curved (${spread.toFixed(1)} m of wander)`)

  const meanV = span.offsets.length === 0 ? 0 : span.offsets.reduce((s, v) => s + v, 0) / span.offsets.length
  for (const l of layouts) {
    const [lo, hi] = WIDTH_PRIOR_M[l.kind]
    if (l.widthM < lo || l.widthM > hi) deduct(ledger, 0.1, `platform ${l.osmWays.join('+')} is ${l.widthM.toFixed(1)} m wide, outside the usual ${lo}-${hi} m for a ${l.kind} platform`)
    const edge = l.edges[0]
    if (l.kind === 'side' && edge && span.offsets.length > 0 && Math.abs(l.centerV - meanV) > 1 && edge.side === (l.centerV < meanV ? -1 : 1)) {
      deduct(ledger, 0.3, `side platform ${l.osmWays.join('+')} has its track on the side away from the other tracks`)
    }
  }
  const only = layouts[0]
  if (layouts.length === 1 && only?.kind === 'side' && span.count >= 2) {
    deduct(ledger, 0.3, `platform ${only.osmWays.join('+')} is a lone side platform; the one for the other direction may be missing from the data`)
    capAt(ledger, LONE_SIDE_CAP, 'a lone side platform')
  }
  const kinds = new Set(layouts.map((l) => l.kind))
  const platformType = kinds.size === 0 ? null : kinds.size === 2 ? 'mixed' : [...kinds][0]!
  return done({ platformType, trackCount: span.count, trackOffsetsV: span.offsets, layouts, geometryOnly: false })
}
