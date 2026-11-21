/** Generated station interiors: classify every catalog station and, for the archetypes with a template at or
 *  above the interior bar, build the same inputs a hand-authored station has. Each candidate is validated by
 *  running the merge (buildStationInterior and markGenerated); a throw skips the station with its reason. Pure. */
import { classifyStation, INTERIOR_MIN_CONFIDENCE } from './archetype.ts'
import type { Archetype } from './archetype.ts'
import { buildAllFacts } from './catalogFacts.ts'
import type { OsmCatalogWay } from './catalogTypes.ts'
import { buildStationInterior } from './stationMerge.ts'
import { markGenerated } from './stationProvenance.ts'
import { parseServing } from './stationSources.ts'
import type { GeneratedStation } from './stationInputs.ts'
import type { TemplateInputs } from './templates/build.ts'
import { makeCtx } from './templates/context.ts'
import type { TemplateCtx } from './templates/context.ts'
import { elevated } from './templates/elevated.ts'
import type { GeneratorCatalog } from './templates/slice.ts'
import { cutCover, shallow } from './templates/subway.ts'
import type { MapTrackLines } from './templates/tracks.ts'

export type { GeneratorCatalog } from './templates/slice.ts'

type Template = (ctx: TemplateCtx, inputs: TemplateInputs, log: string[]) => GeneratedStation
const TEMPLATES: Partial<Record<Archetype, Template>> = {
  'elevated-2-track': elevated,
  'elevated-3-track': elevated,
  'cut-cover-mezzanine': cutCover,
  'shallow-per-direction': shallow,
}

const NAMED_MEZZANINE = /\b(upper|lower|intermediate) mezzanine|\bconcourse\b|\bbalcony\b/i

/** Why a station's E&E rows describe more than one mezzanine level (a template has one), or null. */
export function multiLevelReason(equipment: readonly { code: string; serving: string }[]): string | null {
  for (const e of equipment) {
    const named = NAMED_MEZZANINE.exec(e.serving)
    if (named) return `multi-level: ${e.code} names a ${named[0].toLowerCase()}; needs hand authoring`
    try {
      const s = parseServing(e.serving)
      if (s.from === 'mezzanine' && s.to === 'mezzanine') return `multi-level: ${e.code} joins two mezzanines; needs hand authoring`
    } catch {
      // Unparsable serving texts are dropped row by row (machines.ts), not a reason to skip the station.
    }
  }
  return null
}

export interface GenerateResult {
  /** Sorted by station id. */
  stations: GeneratedStation[]
  /** Candidates (a template archetype at or above the bar) that could not be built. */
  skipped: { stationId: string; reason: string }[]
  /** Dropped rows and long stairs, one line each. */
  log: string[]
}

export function generateStations(catalog: GeneratorCatalog, lines: MapTrackLines): GenerateResult {
  const platformWays = new Map(catalog.platforms.map((w) => [w.id, w]))
  const trackWays = new Map<string, OsmCatalogWay>(catalog.tracks.map((w) => [String(w.id), w]))
  const rows = new Map(catalog.stations.map((s) => [s.gtfsStopId, s]))
  const inputs: TemplateInputs = { catalog, lines, trackWays }
  const out: GenerateResult = { stations: [], skipped: [], log: [] }
  const facts = [...buildAllFacts(catalog)].sort((a, b) => (a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0))
  for (const f of facts) {
    const result = classifyStation(f)
    const template = TEMPLATES[result.archetype]
    if (!template || !result.params || result.confidence < INTERIOR_MIN_CONFIDENCE || result.archetype === 'unknown') continue
    const multi = multiLevelReason(f.equipment)
    if (multi) {
      out.skipped.push({ stationId: f.stationId, reason: multi })
      continue
    }
    const log: string[] = []
    try {
      const ctx = makeCtx(rows.get(f.stationId)!, { archetype: result.archetype, confidence: result.confidence, params: result.params }, platformWays)
      const g = template(ctx, inputs, log)
      markGenerated(buildStationInterior(g.authored, g.sources), g.meta)
      out.stations.push(g)
      out.log.push(...log)
    } catch (err) {
      out.skipped.push({ stationId: f.stationId, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return out
}
