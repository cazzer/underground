/** Station archetype from facts: which hand-built template (if any) a station can be generated from.
 *  Pure. Every confidence deduction pushes a reason; an archetype below INTERIOR_MIN_CONFIDENCE is
 *  informative only and must not be turned into an interior. */
import { parseOsmLevel, stationDepths } from './depth.ts'
import type { DepthResult } from './depth.ts'
import { mezzanineEvidence } from './mezzanineEvidence.ts'
import { toUV } from './platformAxis.ts'
import { analyzePlatforms } from './platformSides.ts'
import type { LayoutAnalysis, PlatformLayout } from './platformSides.ts'
import type { StationFacts } from './stationFacts.ts'
import { geometryProblems } from './stationFactsCheck.ts'
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import { toLatLon } from '../../src/lib/projection.ts'
import type { LatLon } from '../../src/lib/projection.ts'

export type { PlatformLayout } from './platformSides.ts'

export type Archetype =
  | 'elevated-2-track'
  | 'elevated-3-track'
  | 'shallow-per-direction'
  | 'cut-cover-mezzanine'
  | 'underground-express'
  | 'deep'
  | 'open-air'
  | 'unknown'

export interface ArchetypeParams {
  platformType: 'island' | 'side' | 'mixed'
  trackCount: number
  /** [0, 180), same convention as AuthoredStation.frame.bearingDeg. */
  bearingDeg: number
  center: LocalPoint
  /** The lat/lon that `center` and every local point is measured from (StationFacts.origin). */
  origin: LatLon
  /** `center` as lat/lon: the anchor for AuthoredStation.frame. */
  anchor: LatLon
  /** Track positions, v to the right of the bearing, from `center`. */
  trackOffsetsV: number[]
  platforms: PlatformLayout[]
  hasMezzanine: boolean
  /** Entrances on both sides of the track span. */
  perDirectionEntrances: boolean
  entranceSides: (-1 | 1)[]
  depths: DepthResult
}

export interface ArchetypeResult {
  archetype: Archetype
  params: ArchetypeParams | null
  confidence: number
  reasons: string[]
}

export const INTERIOR_MIN_CONFIDENCE = 0.7
const DEEP_PLATFORM_Y = -18.3
const DEEP_OSM_ONLY_PENALTY = 0.2

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
const unknown = (cap: number, reasons: string[], penalty = 0): ArchetypeResult => ({ archetype: 'unknown', params: null, confidence: clamp01(Math.min(cap, 1 - penalty)), reasons })

function entranceSides(f: StationFacts, a: LayoutAnalysis): (-1 | 1)[] {
  const span = a.trackOffsetsV.length === 0 ? 0 : (Math.min(...a.trackOffsetsV) + Math.max(...a.trackOffsetsV)) / 2
  const sides = new Set(f.entrances.map((e) => (toUV(e.at, { bearingDeg: a.bearingDeg, origin: a.center })[1] >= span ? 1 : -1) as -1 | 1))
  return ([-1, 1] as const).filter((s) => sides.has(s))
}

export function classifyStation(f: StationFacts): ArchetypeResult {
  if (f.platforms.length === 0) return unknown(0, ['no platform polygons'])
  const problems = geometryProblems(f)
  if (problems.length > 0) return unknown(0, problems.map((p) => `bad geometry: ${p}`))
  if (f.complex) return unknown(0.2, ['station complex: platforms and levels are shared with other stations'])

  const tagged = f.platforms.map((p) => ({ tag: p.levelTag, level: parseOsmLevel(p.levelTag) }))
  const levels = [...new Set(tagged.flatMap((t) => (t.level === null ? [] : [t.level])))]
  const reasons: string[] = []
  const odd = tagged.filter((t) => t.tag !== null && t.level === null)
  if (odd.length > 0) reasons.push(`OSM level ${odd.map((t) => JSON.stringify(t.tag)).join(', ')} does not name one level; ignored`)
  if (levels.length > 1) return unknown(0.3, [...reasons, `platforms are on ${levels.length} different OSM levels (${levels.join(', ')}): multi-level layout`])
  const platformLevel = levels[0] ?? null

  const analysis = analyzePlatforms(f.platforms, f.tracks)
  reasons.push(...analysis.reasons)
  if (analysis.trackCount < 1 || analysis.trackCount > 4) return unknown(0.3, [...reasons, `${analysis.trackCount} tracks is outside 1-4`], analysis.penalty)
  if (analysis.platformType === null) return unknown(0.3, [...reasons, 'no platform could be read as island or side'], analysis.penalty)

  let penalty = analysis.penalty
  let cap = analysis.cap
  const deduct = (amount: number, why: string): void => {
    penalty += amount
    reasons.push(`${why}: -${amount}`)
  }
  if (f.structure === 'subway' && platformLevel !== null && platformLevel >= 1) deduct(0.3, `subway station but OSM level ${platformLevel} is above the street`)
  if ((f.structure === 'elevated' || f.structure === 'viaduct') && platformLevel !== null && platformLevel <= -1) deduct(0.3, `${f.structure} station but OSM level ${platformLevel} is below the street`)
  if (f.entrances.length === 0) deduct(0.2, 'no entrances')

  const mezz = mezzanineEvidence(f, platformLevel, analysis.layouts)
  reasons.push(mezz.reason)
  penalty += mezz.penalty
  const depths = stationDepths({ stationId: f.stationId, structure: f.structure, hasMezzanine: mezz.value, platformLevel, equipment: f.equipment })
  reasons.push(...depths.reasons)
  const sides = entranceSides(f, analysis)
  const params: ArchetypeParams = {
    platformType: analysis.platformType,
    trackCount: analysis.trackCount,
    bearingDeg: analysis.bearingDeg,
    center: analysis.center,
    origin: f.origin,
    anchor: toLatLon({ x: analysis.center[0], z: analysis.center[1] }, f.origin),
    trackOffsetsV: analysis.trackOffsetsV,
    platforms: analysis.layouts,
    hasMezzanine: mezz.value,
    perDirectionEntrances: sides.length === 2,
    entranceSides: sides,
    depths,
  }
  const result = (archetype: Archetype, why: string, extraCap = 1): ArchetypeResult => {
    cap = Math.min(cap, extraCap)
    reasons.push(why)
    return { archetype, params: archetype === 'unknown' ? null : params, confidence: clamp01(Math.min(cap, 1 - penalty)), reasons }
  }

  const tracks = analysis.trackCount
  if (f.structure === 'elevated' || f.structure === 'viaduct') {
    if (tracks === 2) return result('elevated-2-track', `${f.structure} with 2 tracks`)
    if (tracks === 3) return result('elevated-3-track', `${f.structure} with 3 tracks`)
    return result('unknown', `${f.structure} with ${tracks} tracks has no template`, 0.3)
  }
  if (f.structure !== 'subway') return result('open-air', `${f.structure} station: no roof or mezzanine to model, open-air archetype`)

  if (depths.platform.y <= DEEP_PLATFORM_Y && depths.platform.source !== 'structure-default') {
    if (depths.platform.source === 'osm-level') deduct(DEEP_OSM_ONLY_PENALTY, 'depth rests on the OSM level tag alone')
    return result('deep', `platform ${depths.platform.y.toFixed(1)} m below the street (${depths.platform.source})`)
  }
  if (tracks >= 4 && analysis.layouts.filter((l) => l.kind === 'island').length >= 2) return result('underground-express', `${tracks} tracks with two island platforms`)
  if (analysis.platformType === 'side' && !mezz.value && params.perDirectionEntrances) return result('shallow-per-direction', 'side platforms entered from the street on both sides, no mezzanine')
  if (tracks === 1 || tracks === 3) return result('unknown', `${tracks} tracks under a mezzanine has no template`, 0.4)
  return result('cut-cover-mezzanine', 'subway station with a mezzanine')
}
