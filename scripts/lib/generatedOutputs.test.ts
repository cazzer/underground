/**
 * The committed generated interiors (public/data/stations/) against the generator: enough of them, all at the
 * interior bar, fresh (regenerating from the pinned catalog and the committed shapes reproduces every file), the
 * hand-authored L08 untouched, and nearly every generated track on a map shape (so trains meet the platforms).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ShapesFile, StationsFile } from '../../src/data/schema.ts'
import type { StationDepthsFile, StationIndex, StationInterior } from '../../src/data/stationSchema.ts'
import { buildPolyline } from '../../src/lib/realtime/polyline.ts'
import { profileRuns } from '../../src/lib/trackAnchors.ts'
import { trackLine } from '../../src/lib/trackLine.ts'
import { TRACK_OFFSET_M } from '../../src/lib/trackOffset.ts'
import { INTERIOR_MIN_CONFIDENCE } from './archetype.ts'
import { generateStations } from './generate.ts'
import { CATALOG_FILES, generatorCatalog, generatorLines } from './generatorInputs.ts'
import type { CatalogFileName } from './generatorInputs.ts'
import { toStableJson } from './stableJson.ts'
import { NOT_INTERIOR_FILES } from './stationIndex.ts'
import type { AuthoredStation, StationSources } from './stationInputs.ts'
import { buildStationInterior } from './stationMerge.ts'
import { markGenerated } from './stationProvenance.ts'

const OUT = new URL('../../public/data/stations/', import.meta.url)
const DATA = new URL('../../public/data/', import.meta.url)
const IN = new URL('../../data/stations/', import.meta.url)
const text = (url: URL): string => readFileSync(url, 'utf8')
const json = (url: URL): unknown => JSON.parse(text(url))

const index = json(new URL('index.json', OUT)) as StationIndex
const generatedIds = Object.entries(index.stations).filter(([, e]) => e.provenance === 'generated').map(([id]) => id).sort()
const authoredIds = readdirSync(IN).filter((f) => f.endsWith('.authored.json')).map((f) => f.replace('.authored.json', ''))
const files = readdirSync(OUT).filter((f) => f.endsWith('.json') && !NOT_INTERIOR_FILES.has(f))
/** At least this many: the plan expected about 255 of the 268 candidates (fall 2026 catalog: 264). */
const GENERATED_FLOOR = 250
const MATCHED_SHARE = 0.9

describe('generated station interiors', () => {
  it(`commits at least ${GENERATED_FLOOR}, each at or above the interior bar and never a hand-authored one`, () => {
    expect(generatedIds.length).toBeGreaterThanOrEqual(GENERATED_FLOOR)
    for (const id of generatedIds) {
      const interior = json(new URL(`${id}.json`, OUT)) as StationInterior
      expect(interior.generated?.confidence, id).toBeGreaterThanOrEqual(INTERIOR_MIN_CONFIDENCE)
      expect(authoredIds, id).not.toContain(id)
    }
  })

  it('leaves L08 exactly as its authored build', () => {
    const authored = json(new URL('L08.authored.json', IN)) as AuthoredStation
    const sources = json(new URL('L08.sources.json', IN)) as StationSources
    expect(toStableJson(buildStationInterior(authored, sources), 2)).toBe(text(new URL('L08.json', OUT)))
  })

  it('is fresh: regenerating from the catalog reproduces every generated file byte for byte', () => {
    const catalog = generatorCatalog(Object.fromEntries(CATALOG_FILES.map((f) => [f, json(new URL(`catalog/${f}`, IN))])) as Record<CatalogFileName, unknown>)
    const lines = generatorLines(json(new URL('shapes.json', DATA)), json(new URL('stations.json', DATA)))
    const fresh = generateStations(catalog, lines).stations.filter((g) => !authoredIds.includes(g.authored.stationId))
    expect(fresh.map((g) => g.authored.stationId).sort()).toEqual(generatedIds)
    expect(files.length).toBe(generatedIds.length + authoredIds.length)
    for (const g of fresh) {
      const built = toStableJson(markGenerated(buildStationInterior(g.authored, g.sources), g.meta), 2)
      expect(built, g.authored.stationId).toBe(text(new URL(`${g.authored.stationId}.json`, OUT)))
    }
  })

  it(`puts at least ${MATCHED_SHARE * 100}% of generated tracks on a map shape of their direction`, () => {
    const depths = json(new URL('depths-generated.json', OUT)) as StationDepthsFile
    const shapes = (json(new URL('shapes.json', DATA)) as ShapesFile).shapes
    const stations = (json(new URL('stations.json', DATA)) as StationsFile).stations
    const { unmatched } = profileRuns(
      depths,
      stations.map((s) => ({ id: s.id, routeIds: s.routes })),
      shapes.map((s) => ({ id: s.id, routeId: s.routeId, direction: s.direction, line: buildPolyline(trackLine(s, TRACK_OFFSET_M)) })),
    )
    const total = depths.stations.reduce((n, s) => n + s.tracks.length, 0)
    expect(total).toBe(2 * generatedIds.length)
    expect(1 - unmatched.length / total).toBeGreaterThanOrEqual(MATCHED_SHARE)
  })
})
