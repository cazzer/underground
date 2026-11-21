/** Keeps the client's interior registry in sync with the committed interior files, and checks they all draw. */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INTERIOR_STATION_IDS } from '../../src/data/interiorRegistry.ts'
import type { StationInterior } from '../../src/data/stationSchema.ts'
import { buildInteriorBuffers } from '../../src/lib/interiorGeometry.ts'

const dir = new URL('../../public/data/stations/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
const read = (id: string) => JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8')) as StationInterior

const OPTIONS = {
  yScale: 2,
  stepRise: 0.18,
  railDrop: 1.1,
  entranceSize: 2.5,
  guides: true,
  machines: { escalator: 'rails', elevator: 'cab' } as const,
  colorOf: () => [1, 1, 1] as const,
}

describe('interior registry', () => {
  it('lists exactly the stations with a public/data/stations file', () => {
    expect([...INTERIOR_STATION_IDS].sort()).toEqual(files.map((f) => f.replace(/\.json$/, '')).sort())
  })

  it.each(INTERIOR_STATION_IDS)('%s builds non-empty interior buffers', (id) => {
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
