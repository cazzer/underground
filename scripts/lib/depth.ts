/** Level elevations relative to the street (0, negative below) from the best evidence available:
 *  E&E rises, then a published depth, then the OSM `level` tag, then a default for the structure. */
import { DEEP_STATIONS } from './deepStations.ts'
import type { DeepStation } from './deepStations.ts'
import { parseRise } from './riseParse.ts'
import type { EquipmentFact, Structure } from './stationFacts.ts'
import { parseServing } from './stationSources.ts'

export type DepthSource = 'ee-rise' | 'deep-list' | 'osm-level' | 'structure-default'
export interface LevelDepth {
  y: number
  source: DepthSource
}
export interface DepthResult {
  platform: LevelDepth
  mezzanine: LevelDepth | null
  reasons: string[]
}
export interface DepthInput {
  stationId: string
  structure: Structure
  hasMezzanine: boolean
  platformLevel: number | null
  equipment: EquipmentFact[]
}

const LEVEL_M = 4.5
const MIN_RISE_M = 1
const MAX_RISE_M = 60
const MIN_SEPARATION_M = 2.5

/** "-2" is -2. Lists ("-1;-2"), blanks and words ("B") are null: the tag does not name one level. */
export function parseOsmLevel(tag: string | null): number | null {
  if (tag === null) return null
  const s = tag.trim()
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null
}

/** +1 above the street, -1 below, 0 at grade. */
function signOf(structure: Structure): 1 | -1 | 0 {
  if (structure === 'subway' || structure === 'open-cut') return -1
  if (structure === 'at-grade') return 0
  return 1
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

interface Rises {
  streetPlatform: number[]
  streetMezzanine: number[]
  mezzaninePlatform: number[]
}

/** Rises in meters grouped by the pair of levels the machine joins. Every machine we skip says why. */
function collectRises(equipment: EquipmentFact[], reasons: string[]): Rises {
  const out: Rises = { streetPlatform: [], streetMezzanine: [], mezzaninePlatform: [] }
  for (const e of equipment) {
    let pair: string
    try {
      const s = parseServing(e.serving)
      pair = [s.from, s.to].sort().join('+')
    } catch (err) {
      reasons.push(`${e.code}: ignored for depth: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    if (e.rise === null) continue
    const r = parseRise(e.rise)
    if (!r.ok) {
      reasons.push(`${e.code}: rise ignored: ${r.reason}`)
      continue
    }
    if (r.warning) reasons.push(`${e.code}: ${r.warning}`)
    if (r.m < MIN_RISE_M || r.m > MAX_RISE_M) {
      reasons.push(`${e.code}: rise ${r.m.toFixed(2)} m is outside ${MIN_RISE_M}-${MAX_RISE_M} m, ignored`)
      continue
    }
    if (pair === 'platform+street') out.streetPlatform.push(r.m)
    else if (pair === 'mezzanine+street') out.streetMezzanine.push(r.m)
    else if (pair === 'mezzanine+platform') out.mezzaninePlatform.push(r.m)
    else reasons.push(`${e.code}: rise ignored: it joins ${pair.replace('+', ' and ')}`)
  }
  return out
}

function defaultDepths(structure: Structure, hasMezzanine: boolean): { platform: number; mezzanine: number | null } {
  switch (structure) {
    case 'subway':
      return hasMezzanine ? { platform: -9, mezzanine: -4.5 } : { platform: -5, mezzanine: null }
    case 'elevated':
    case 'viaduct':
      return { platform: 8, mezzanine: hasMezzanine ? 4 : null }
    case 'open-cut':
      return { platform: -5, mezzanine: null }
    case 'at-grade':
      return { platform: 0, mezzanine: null }
    case 'embankment':
      return { platform: 4, mezzanine: null }
  }
}

export function stationDepths(i: DepthInput, deepList: DeepStation[] = DEEP_STATIONS): DepthResult {
  const reasons: string[] = []
  const sign = signOf(i.structure)
  const defaults = defaultDepths(i.structure, i.hasMezzanine)
  const rises = sign === 0 ? { streetPlatform: [], streetMezzanine: [], mezzaninePlatform: [] } : collectRises(i.equipment, reasons)

  let mezzanine: LevelDepth | null = null
  if (i.hasMezzanine && rises.streetMezzanine.length > 0) mezzanine = { y: sign * median(rises.streetMezzanine), source: 'ee-rise' }

  let platform: LevelDepth | null = null
  if (rises.streetPlatform.length > 0) {
    platform = { y: sign * median(rises.streetPlatform), source: 'ee-rise' }
  } else if (rises.mezzaninePlatform.length > 0) {
    if (mezzanine?.source === 'ee-rise') platform = { y: mezzanine.y + sign * median(rises.mezzaninePlatform), source: 'ee-rise' }
    else reasons.push('mezzanine-to-platform rise ignored: the mezzanine depth is not measured')
  }
  const deep = deepList.find((d) => d.stationId === i.stationId)
  if (!platform && deep) platform = { y: deep.platformY, source: 'deep-list' }

  const level = i.platformLevel
  const levelUsable = level !== null && sign !== 0 && level * sign > 0
  if (level !== null && !levelUsable) reasons.push(`OSM level ${level} contradicts a ${i.structure} structure; ignored for depth`)
  if (!platform && levelUsable) {
    platform = { y: level * LEVEL_M, source: 'osm-level' }
    if (i.hasMezzanine && !mezzanine) mezzanine = { y: (level + (sign < 0 ? 1 : -1)) * LEVEL_M, source: 'osm-level' }
  }
  if (!platform) {
    platform = { y: defaults.platform, source: 'structure-default' }
    reasons.push(`platform depth from the ${i.structure} default (${defaults.platform} m)`)
  }
  if (i.hasMezzanine && !mezzanine) {
    mezzanine = { y: defaults.mezzanine ?? platform.y / 2, source: 'structure-default' }
  }
  if (!i.hasMezzanine) mezzanine = null

  if (mezzanine && sign !== 0) {
    // Depth below (or height above) the street, so both ends compare the same way.
    const away = mezzanine.y * sign
    const platformAway = platform.y * sign
    if (away < MIN_SEPARATION_M || away > platformAway - MIN_SEPARATION_M) {
      reasons.push(`mezzanine ${mezzanine.y} m is not ${MIN_SEPARATION_M} m from both the street and the platform ${platform.y} m; set to half the platform depth`)
      mezzanine = { y: platform.y / 2, source: 'structure-default' }
    }
  }
  return { platform, mezzanine, reasons }
}
