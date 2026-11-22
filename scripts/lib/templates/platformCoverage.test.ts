import { describe, expect, it } from 'vitest'
import type { StationInterior } from '../../../src/data/stationSchema.ts'
import { generateStations } from '../generate.ts'
import { distanceToRing } from '../stationGeometry.ts'
import { buildStationInterior } from '../stationMerge.ts'
import { markGenerated } from '../stationProvenance.ts'
import type { GeneratedStation } from '../stationInputs.ts'
import { fixtureCatalog, sideShallow } from './templateFixture.ts'
import type { FixtureSpec } from './templateFixture.ts'

function generate(spec: FixtureSpec): { g: GeneratedStation; interior: StationInterior } {
  const { catalog, lines } = fixtureCatalog(spec)
  const result = generateStations(catalog, lines)
  expect(result.skipped).toEqual([])
  expect(result.stations).toHaveLength(1)
  const g = result.stations[0]!
  return { g, interior: markGenerated(buildStationInterior(g.authored, g.sources), g.meta) }
}

/** Every platform with a track has a connector end on its level within the merge's 0.5 m of its outline. */
function expectEveryPlatformConnected(interior: StationInterior): void {
  for (const p of interior.platforms.filter((x) => x.tracks.length > 0)) {
    const ends = interior.connectors.flatMap((c) => [c.lower, c.upper]).filter((e) => e.level === p.level)
    expect(Math.min(...ends.map((e) => distanceToRing([e.x, e.z], p.outline))), `platform ${p.id} has a connector`).toBeLessThanOrEqual(0.5)
  }
}

/** Platform coverage (stairs.ts `coverPlatforms`): every platform with a track gets a street stair or machine. */
describe('platform coverage (no mezzanine)', () => {
  const withEntrance = (at: [number, number]): FixtureSpec => {
    const spec = sideShallow()
    spec.entrances[1] = { type: 'Stair', at }
    return spec
  }
  const stairIds = (g: GeneratedStation): string[] => g.authored.connectors.map((c) => c.id)

  it('leaves the base fixture, where each platform has its own entrance, connected', () => {
    expectEveryPlatformConnected(generate(sideShallow()).interior)
  })

  it('lands a stair on the near edge of a platform whose centerline is out of reach', () => {
    const { g, interior } = generate(withEntrance([60, 33]))
    expect(stairIds(g)).toContain('st-ent-03')
    const stair = g.authored.connectors.find((c) => c.id === 'st-ent-03')!
    expect(stair.lower).toEqual({ level: 'platform', at: [60, 13.5] })
    expect(g.authored.notes ?? '').not.toContain('finds no free landing')
    expectEveryPlatformConnected(interior)
  })

  it('adds a second stair from an entrance that already has one when the other platform has none', () => {
    const { g, interior } = generate(withEntrance([60, -1]))
    const ent = interior.entrances.find((e) => e.connectors.includes('st-ent-03'))!
    expect(ent.connectors).toEqual(['st-ent-03', 'st-ent-03-p2'])
    expect(stairIds(g)).toContain('st-ent-03-p2')
    expectEveryPlatformConnected(interior)
  })

  it('skips the station when no entrance that does not cross a platform reaches one of them', () => {
    const { catalog, lines } = fixtureCatalog(withEntrance([60, 40]))
    const result = generateStations(catalog, lines)
    expect(result.stations).toEqual([])
    expect(result.skipped).toEqual([{ stationId: 'T20', reason: 'platform 2: no street stair reaches it within 20 m' }])
  })

  it('never serves a platform from an entrance that has the other platform between it and the platform', () => {
    // Close platforms (centers at v -7.5 and 7.5) and one entrance at v -14, outside P1. It is 19 m from P2's near
    // edge (v 5), so without the no-crossing rule the coverage pass would land its stair on that edge at about
    // [u, 5.5] with a run of 19.5 m (the edge point, since P2's centerline is 21.5 m away), and the station
    // would generate. P1's center line (-7.5) lies strictly between -14 and 7.5, so the entrance is not a
    // candidate for P2, and with no other entrance the station is skipped.
    const spec = sideShallow()
    spec.platforms = [[-10, -5], [5, 10]]
    spec.tracks = [-2.6, 2.6]
    spec.entrances = [{ type: 'Stair', at: [60, -14] }]
    spec.equipment = []
    const { catalog, lines } = fixtureCatalog(spec)
    const result = generateStations(catalog, lines)
    expect(result.stations).toEqual([])
    expect(result.skipped).toEqual([{ stationId: 'T20', reason: 'platform 2: no street stair reaches it within 20 m' }])
  })

  it('counts a platform a street elevator lands on as reached, so it gets no stair', () => {
    const spec = sideShallow()
    spec.entrances.splice(1, 1)
    spec.equipment = [{ ...spec.equipment[0]!, serving: 'Main St (SE corner) to Brooklyn-bound platform' }]
    const { g, interior } = generate(spec)
    expect(g.authored.connectors.filter((c) => c.id.startsWith('st-'))).toHaveLength(1)
    expectEveryPlatformConnected(interior)
  })
})
