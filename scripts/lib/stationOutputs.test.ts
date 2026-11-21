/** Checks the committed public/data/stations/ files: the index lists exactly them, and they all draw. */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationIndex, StationInterior } from '../../src/data/stationSchema.ts'
import { buildInteriorBuffers, RAIL_DROP_M } from '../../src/lib/interiorGeometry.ts'
import { toStableJson } from './stableJson.ts'
import { buildStationIndex, INDEX_FILE, NOT_INTERIOR_FILES } from './stationIndex.ts'

const dir = new URL('../../public/data/stations/', import.meta.url)
const ids = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && !NOT_INTERIOR_FILES.has(f))
  .map((f) => f.replace(/\.json$/, ''))
  .sort()
const read = (id: string) => JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8')) as StationInterior
const indexText = readFileSync(new URL(INDEX_FILE, dir), 'utf8')
const index = JSON.parse(indexText) as StationIndex

const OPTIONS = {
  yScale: 2,
  stepRise: 0.18,
  railDrop: RAIL_DROP_M,
  entranceSize: 2.5,
  guides: true,
  colorOf: () => [1, 1, 1] as const,
}

describe('station index', () => {
  it('lists exactly the stations with a public/data/stations file', () => {
    // Compared sorted: JS puts integer-like keys first when it writes the object.
    expect(Object.keys(index.stations).sort()).toEqual(ids)
  })

  it.each(ids)('%s: the entry matches the interior file', (id) => {
    const interior = read(id)
    expect(interior.stationId).toBe(id)
    expect(index.stations[id]?.provenance).toBe(interior.generated ? 'generated' : 'authored')
  })

  it('is fresh: rebuilding from the committed files reproduces index.json byte for byte', () => {
    expect(toStableJson(buildStationIndex(ids.map(read)), 2)).toBe(indexText)
  })
})

describe('station interior files', () => {
  it.each(ids)('%s builds non-empty interior buffers', (id) => {
    const { strong, fine } = buildInteriorBuffers(read(id), OPTIONS)
    expect(strong.positions.length).toBeGreaterThan(0)
    expect(fine.positions.length).toBeGreaterThan(0)
  })

  it('L08 draws three levels and every connector: 4 strong edges per stair, 14 per elevator (look A)', () => {
    const l08 = read('L08')
    expect(l08.levels).toHaveLength(3)
    const kinds = l08.connectors.map((c) => c.kind)
    expect(kinds.filter((k) => k === 'stair')).toHaveLength(11)
    expect(kinds.filter((k) => k === 'elevator')).toHaveLength(2)
    const segments = (i: StationInterior) => buildInteriorBuffers(i, OPTIONS).strong.positions.length / 6
    expect(segments(l08) - segments({ ...l08, connectors: [] })).toBe(11 * 4 + 2 * 14)
  })
})
