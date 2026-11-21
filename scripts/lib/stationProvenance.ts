/** Marks a built interior as generated: provenance on every element, a depth source on every non-street
 *  level, and the archetype and confidence. Pure and non-mutating. */
import type { InteriorSource, Level, StationInterior } from '../../src/data/stationSchema.ts'
import { INTERIOR_MIN_CONFIDENCE } from './archetype.ts'
import type { GeneratedMeta } from './stationInputs.ts'

function generatedSources(sources: readonly InteriorSource[]): InteriorSource[] {
  return [...new Set(sources.map((s): InteriorSource => (s === 'authored' ? 'generated' : s)))].sort()
}

function withDepthSources(interior: StationInterior, depths: GeneratedMeta['levelDepths']): Level[] {
  const id = interior.stationId
  const known = new Set(interior.levels.map((l) => l.id))
  for (const key of Object.keys(depths)) {
    if (!known.has(key)) throw new Error(`${id}: levelDepths names unknown level "${key}"`)
  }
  return interior.levels.map((l) => {
    if (l.kind === 'street') {
      if (Object.hasOwn(depths, l.id)) throw new Error(`${id}: levelDepths must not name the street level "${l.id}"`)
      return { ...l }
    }
    const depthSource = Object.hasOwn(depths, l.id) ? depths[l.id] : undefined
    if (!depthSource) throw new Error(`${id}: levelDepths is missing level "${l.id}"`)
    return { ...l, depthSource }
  })
}

export function markGenerated(interior: StationInterior, meta: GeneratedMeta): StationInterior {
  const id = interior.stationId
  const { confidence } = meta
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`${id}: confidence must be a number in [0, 1], got ${confidence}`)
  }
  if (confidence < INTERIOR_MIN_CONFIDENCE) {
    throw new Error(`${id}: confidence ${confidence} is below the interior bar ${INTERIOR_MIN_CONFIDENCE}`)
  }
  const mark = <T extends { sources: InteriorSource[] }>(e: T): T => ({ ...e, sources: generatedSources(e.sources) })
  return {
    stationId: interior.stationId,
    name: interior.name,
    anchor: { ...interior.anchor },
    license: interior.license,
    attribution: [...interior.attribution],
    generated: { archetype: meta.archetype, confidence },
    levels: withDepthSources(interior, meta.levelDepths),
    platforms: interior.platforms.map(mark),
    slabs: interior.slabs.map(mark),
    connectors: interior.connectors.map(mark),
    entrances: interior.entrances.map(mark),
    fareLines: interior.fareLines.map(mark),
  }
}
