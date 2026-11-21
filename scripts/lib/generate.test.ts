import { describe, expect, it } from 'vitest'
import type { StationInterior } from '../../src/data/stationSchema.ts'
import { generateStations } from './generate.ts'
import { buildStationInterior } from './stationMerge.ts'
import { distanceToRing } from './stationGeometry.ts'
import { markGenerated } from './stationProvenance.ts'
import type { GeneratedStation } from './stationInputs.ts'
import { directionOf } from './templates/machines.ts'
import { elevatedIsland, fixtureCatalog, islandCutCover, latLonAt, sideShallow } from './templates/templateFixture.ts'
import type { FixtureSpec } from './templates/templateFixture.ts'

function generate(spec: FixtureSpec): { g: GeneratedStation; interior: StationInterior } {
  const { catalog, lines } = fixtureCatalog(spec)
  const result = generateStations(catalog, lines)
  expect(result.skipped).toEqual([])
  expect(result.stations).toHaveLength(1)
  const g = result.stations[0]!
  return { g, interior: markGenerated(buildStationInterior(g.authored, g.sources), g.meta) }
}

/** Every non-street connector end lies on a platform or slab of its level (what the merge checks, restated). */
function expectLandingsContained(interior: StationInterior): void {
  const street = interior.levels.find((l) => l.kind === 'street')!.id
  for (const c of interior.connectors) {
    for (const end of [c.lower, c.upper]) {
      if (end.level === street) continue
      const areas = [...interior.platforms, ...interior.slabs].filter((a) => a.level === end.level)
      expect(Math.min(...areas.map((a) => distanceToRing([end.x, end.z], a.outline))), `${c.id} on ${end.level}`).toBeLessThanOrEqual(0.5)
    }
  }
}

/** v of a track in the generated frame (its mean over the path). */
const trackV = (g: GeneratedStation, stopId: string): number => {
  const path = g.authored.platforms.flatMap((p) => p.tracks).find((t) => t.stopId === stopId)!.path
  return path.reduce((s, p) => s + p[1], 0) / path.length
}

describe('cut-and-cover island template', () => {
  it('builds a merge-valid interior: two mezzanine slabs, stairs and machines landing on their levels', () => {
    const { g, interior } = generate(islandCutCover())
    expect(interior.generated).toEqual({ archetype: 'cut-cover-mezzanine', confidence: g.meta.confidence })
    expect(interior.levels.map((l) => [l.kind, l.depthSource])).toEqual([['street', undefined], ['mezzanine', 'osm-level'], ['platform', 'osm-level']])
    expect(interior.slabs).toHaveLength(2)
    expect(interior.connectors.filter((c) => c.id.startsWith('st-slab-')).map((c) => c.width)).toEqual([2.4, 2.4])
    expectLandingsContained(interior)
  })

  it('claims every row it keeps and drops (and notes) the ones the merge cannot take', () => {
    const { g, interior } = generate(islandCutCover())
    expect(g.sources.equipment.rows.map((r) => r.code)).toEqual(['EL1', 'EL2'])
    expect(interior.entrances).toHaveLength(g.sources.entrances.rows.length)
    expect(g.sources.entrances.rows.map((r) => r.type)).not.toContain('Escalator')
    const dropped = g.authored.notes.filter((n) => n.startsWith('Dropped:'))
    expect(dropped.join('\n')).toMatch(/ES8: joins mezzanine to mezzanine/)
    expect(dropped.join('\n')).toMatch(/EL9: serving text has more than one " to "/)
    expect(dropped.join('\n')).toMatch(/\(Escalator\): no escalator/)
  })

  it('puts the street elevator at its Elevator entrance, inside a slab', () => {
    const { interior } = generate(islandCutCover())
    const el1 = interior.connectors.find((c) => c.id === 'EL1')!
    const entrance = interior.entrances.find((e) => e.connectors.includes('EL1'))!
    expect(entrance.type).toBe('Elevator')
    expect([el1.upper.x, el1.upper.z]).toEqual([entrance.x, entrance.z])
  })

  it.each([1, -1] as const)('takes N/S from the map lines, not from right-hand running (north side %i)', (side) => {
    const { g } = generate(islandCutCover(side))
    expect(Math.sign(trackV(g, 'T10N'))).toBe(side)
    expect(Math.sign(trackV(g, 'T10S'))).toBe(-side)
    // The OSM ways are straight here, so the paths are the ways clipped to the platform.
    expect(g.authored.notes.some((n) => n.includes('straight track'))).toBe(false)
  })
})

describe('shallow side-platform template', () => {
  it('has no mezzanine, draws only the two platform-edge tracks, and lands stairs on the nearer platform', () => {
    const { g, interior } = generate(sideShallow())
    expect(interior.generated?.archetype).toBe('shallow-per-direction')
    expect(interior.levels.map((l) => l.kind)).toEqual(['street', 'platform'])
    expect(interior.slabs).toEqual([])
    expect(interior.platforms.flatMap((p) => p.tracks.map((t) => t.stopId)).sort()).toEqual(['T20N', 'T20S'])
    expect(Math.abs(trackV(g, 'T20N'))).toBeCloseTo(6.6, 0)
    // Each stair runs from a Stair entrance down to the side platform on the entrance's side of the tracks.
    const entranceV = new Map(g.sources.entrances.rows.map((r, i) => [`ent-${String(i + 1).padStart(2, '0')}`, r]))
    expect(g.authored.connectors).toHaveLength(2)
    for (const c of g.authored.connectors) {
      const ent = (c.upper as { entrance: string }).entrance
      expect(entranceV.get(ent)?.type).toBe('Stair')
      const end = interior.connectors.find((x) => x.id === c.id)!
      const top = interior.entrances.find((e) => e.id === ent)!
      const v = (c.lower as { at: [number, number] }).at[1]
      expect(Math.abs(v)).toBeGreaterThan(9)
      expect(end.lower.level).toBe('platform')
      // Same side as its entrance (the fixture's frame and the generated one share the bearing and nearly the origin).
      const row = entranceV.get(ent)!
      const spec = sideShallow().entrances.find((e) => latLonAt(sideShallow(), e.at).join() === `${row.lat},${row.lon}`)!
      expect(Math.sign(v)).toBe(Math.sign(spec.at[1]))
      expect(top.connectors).toEqual([c.id])
    }
    expectLandingsContained(interior)
  })

  it('sends a street elevator to the platform its serving text names (the northbound one here)', () => {
    const { g } = generate(sideShallow())
    const el5 = g.authored.equipment.find((e) => e.code === 'EL5')!
    expect(Math.sign(el5.at![1])).toBe(Math.sign(trackV(g, 'T20N')))
    expect(el5.entrance).toMatch(/^ent-/)
  })
})

describe('elevated template', () => {
  it('puts the street below the station house and platform, with each entrance at its connector\'s lower end', () => {
    const { g, interior } = generate(elevatedIsland())
    expect(interior.generated?.archetype).toBe('elevated-2-track')
    expect(interior.levels.map((l) => [l.id, l.y])).toEqual([['platform', 9], ['station-house', 4.5], ['street', 0]])
    for (const c of g.authored.connectors.filter((x) => x.id.startsWith('st-ent-'))) expect(c.lower).toHaveProperty('entrance')
    const stair = g.authored.connectors.find((c) => c.id.startsWith('st-slab-'))!
    expect(stair.lower).toHaveProperty('level', 'station-house')
    expect(stair.upper).toHaveProperty('level', 'platform')
    const byId = new Map(interior.connectors.map((c) => [c.id, c]))
    const machine = (type: string) => interior.entrances.find((e) => e.type === type)!.connectors.map((id) => byId.get(id)!)
    expect(machine('Elevator').map((c) => [c.kind, c.lower.level, c.upper.level])).toEqual([['elevator', 'street', 'platform']])
    expect(machine('Escalator').map((c) => [c.kind, c.lower.level, c.upper.level])).toEqual([['escalator', 'street', 'station-house']])
    expectLandingsContained(interior)
  })
})

describe('directionOf', () => {
  const row = { northLabel: 'Manhattan', southLabel: 'Coney Island' }
  it.each([
    ['mezzanine to Manhattan-bound platform', 'N'],
    ['Mezzanine to Coney Island-bound platform', 'S'],
    ['street to uptown platform', 'N'],
    ['Street to downtown 1 platform.', 'S'],
    ['mezzanine to platform for service in both directions', undefined],
    ['mezzanine to platform', undefined],
  ])('%s -> %s', (serving, want) => {
    expect(directionOf(serving, row)).toBe(want)
  })

  it('ignores a "Last Stop" label', () => {
    expect(directionOf('mezzanine to last stop platform', { northLabel: 'Last Stop', southLabel: 'Manhattan' })).toBeUndefined()
  })
})
