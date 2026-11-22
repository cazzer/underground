import { describe, expect, it } from 'vitest'
import { decodeStationDepths, type DepthsStations } from '../../src/data/depthsCodec.ts'
import type { StationDepthsFile, StationInterior } from '../../src/data/stationSchema.ts'
import { toGround } from '../../src/lib/projection.ts'
import { buildPolyline } from '../../src/lib/realtime/polyline.ts'
import { profileRuns, type AnchorShape } from '../../src/lib/trackAnchors.ts'
import { complexFixture } from './complexFixture.ts'
import { PACK_TOL_M, packStationDepths } from './depthsPack.ts'
import { ANCHOR, fixture, ll } from './stationFixture.ts'
import { buildStationDepths } from './stationDepths.ts'
import { buildStationIndex } from './stationIndex.ts'
import { buildStationInterior } from './stationMerge.ts'
import { checkMembers, membersOf, trackOwner } from './stationMembers.ts'

type Fixture = ReturnType<typeof complexFixture>
const build = (mutate: (f: Fixture) => void = () => {}): StationInterior => {
  const f = complexFixture()
  mutate(f)
  return buildStationInterior(f.authored, f.sources)
}
const connector = (f: Fixture, id: string) => f.authored.connectors.find((c) => c.id === id)!
const walkway = (f: Fixture) => connector(f, 'wk-1') as { lower: Record<string, unknown>; upper: Record<string, unknown> }

describe('a complex interior', () => {
  const out = build()
  it('names its members right after the station id and keeps both stations platforms', () => {
    expect(out.stationId).toBe('T01')
    expect(out.memberStationIds).toEqual(['T01', 'U01'])
    expect(Object.keys(out).slice(0, 3)).toEqual(['stationId', 'memberStationIds', 'name'])
    expect(out.platforms.flatMap((p) => p.tracks.map((t) => t.stopId))).toEqual(['T01N', 'T01S', 'U01N', 'U01S'])
  })
  it('keeps the walkway with the area at each end, and the paid slabs', () => {
    const wk = out.connectors.find((c) => c.id === 'wk-1')!
    expect([wk.kind, wk.lower.level, wk.upper.level, wk.lower.area, wk.upper.area]).toEqual(['walkway', 'mezz', 'mezz', 'mezz-t', 'mezz-u'])
    expect(wk.sources).toEqual(['authored'])
    expect(out.slabs.map((s) => s.paid)).toEqual([true, true])
  })
  it('puts an area only on the ends that name one', () => {
    const f = complexFixture()
    delete (connector(f, 'st-plat-t').lower as { area?: string }).area
    const stair = buildStationInterior(f.authored, f.sources).connectors.find((c) => c.id === 'st-plat-t')!
    expect(Object.keys(stair.lower)).toEqual(['x', 'z', 'level'])
    expect(stair.upper.area).toBe('mezz-t')
  })
  it('emits neither members nor paid for an ordinary station', () => {
    const f = fixture()
    const plain = buildStationInterior(f.authored, f.sources)
    expect(plain.memberStationIds).toBeUndefined()
    expect(plain.slabs.every((s) => !('paid' in s))).toBe(true)
  })
})

describe('members', () => {
  it('membersOf and trackOwner pick the longest prefix', () => {
    expect(membersOf({ stationId: 'A' })).toEqual(['A'])
    expect(membersOf({ stationId: 'A', memberStationIds: ['A', 'B'] })).toEqual(['A', 'B'])
    expect(trackOwner('635N', ['6', '635'])).toBe('635')
    expect(trackOwner('6N', ['6', '635'])).toBe('6')
    expect(trackOwner('X1N', ['6', '635'])).toBeUndefined()
  })
  it.each([
    ['a stop of no member', (f: Fixture) => { f.authored.platforms[0]!.tracks[0]!.stopId = 'X01N' }, /X01N is not a stop of T01, U01/],
    ['a station id that is not first', (f: Fixture) => { f.authored.stationId = 'U01' }, /must be the first member/],
    ['unsorted members', (f: Fixture) => { f.authored.memberStationIds = ['U01', 'T01'] }, /sorted ascending/],
    ['a duplicate member', (f: Fixture) => { f.authored.memberStationIds = ['T01', 'T01'] }, /duplicate member T01/],
    ['a single member', (f: Fixture) => { f.authored.memberStationIds = ['T01'] }, /at least 2 members/],
    ['an unusable member id', (f: Fixture) => { f.authored.memberStationIds = ['T01', '../x'] }, /not a usable station id/],
    ['the index file name', (f: Fixture) => { f.authored.memberStationIds = ['T01', 'index'] }, /not a usable station id/],
  ])('rejects %s', (_name, mutate, message) => {
    expect(() => build(mutate)).toThrow(message)
  })
  it('checkMembers passes an absent list through', () => {
    expect(checkMembers('T01', undefined, 'memberStationIds')).toBeUndefined()
  })
})

describe('walkways and areas', () => {
  it.each([
    ['two levels', (f: Fixture) => { walkway(f).upper = { level: 'platform', at: [-20, 50], area: 'island-u' } }, /stays on one level/],
    ['an entrance end', (f: Fixture) => { walkway(f).upper = { entrance: 'ent-u' } }, /no entrance end/],
    ['no area', (f: Fixture) => { delete walkway(f).upper.area }, /names the area at each end/],
    ['the same area at both ends', (f: Fixture) => { walkway(f).upper = { level: 'mezz', at: [-20, 5], area: 'mezz-t' } }, /two different areas/],
  ])('rejects a walkway with %s', (_name, mutate, message) => {
    expect(() => build(mutate)).toThrow(message)
  })
  it('rejects a walkway on the street level', () => {
    expect(() => build((f) => {
      walkway(f).lower = { level: 'street', at: [-20, 9] }
      walkway(f).upper = { level: 'street', at: [-20, 41] }
    })).toThrow(/not on the street level/)
  })
  it('rejects a walkway shorter than a meter', () => {
    expect(() => build((f) => {
      f.authored.slabs[1]!.outline = [[-30, 9.5], [-10, 9.5], [-10, 20], [-30, 20]]
      walkway(f).upper = { level: 'mezz', at: [-20, 9.6], area: 'mezz-u' }
    })).toThrow(/runs at least 1 m/)
  })
  it.each([
    ['an unknown area', (f: Fixture) => { walkway(f).lower.area = 'nope' }, /unknown platform or slab "nope"/],
    ['an area on another level', (f: Fixture) => { walkway(f).lower.area = 'island-t' }, /island-t is on level platform, not mezz/],
    ['an end more than 0.5 m outside its area', (f: Fixture) => { walkway(f).lower = { level: 'mezz', at: [-20, 11], area: 'mezz-t' } }, /outside its area mezz-t/],
    ['an area on an `at` end at the street level', (f: Fixture) => { walkway(f).lower = { level: 'street', at: [-20, 9], area: 'mezz-t' } }, /an end on the street level has no area/],
    ['an area on an entrance end', (f: Fixture) => { (connector(f, 'st-street-t').upper as Record<string, unknown>).area = 'mezz-t' }, /entrance end is on the street and has no area/],
    ['a paid that is not a boolean', (f: Fixture) => { (f.authored.slabs[0] as { paid: unknown }).paid = 'yes' }, /slabs\[0\]\.paid/],
  ])('rejects %s', (_name, mutate, message) => {
    expect(() => build(mutate)).toThrow(message)
  })
  it('still requires a stair to run upward', () => {
    expect(() => build((f) => {
      const stair = connector(f, 'st-plat-t')
      ;[stair.lower, stair.upper] = [stair.upper, stair.lower]
    })).toThrow(/lower end must be below the upper end/)
  })
  it('checks an unnamed end against any polygon on its level, as before', () => {
    expect(() => build((f) => { connector(f, 'st-plat-t').upper = { level: 'mezz', at: [-21, 30] } })).toThrow(/outside every polygon on level mezz/)
  })
})

describe('depths, pack and index', () => {
  const complex = build()
  const depths = buildStationDepths([complex])
  it('gives each member its own tracks and the shared anchor', () => {
    expect(depths.stations.map((s) => [s.stationId, s.tracks.map((t) => t.stopId)])).toEqual([['T01', ['T01N', 'T01S']], ['U01', ['U01N', 'U01S']]])
    expect(depths.stations[0]!.anchor).toEqual(depths.stations[1]!.anchor)
    expect(depths.stations[0]!.tracks[0]!.railY).toBe(depths.stations[1]!.tracks[0]!.railY)
  })
  it('throws when a second interior has depths for a member', () => {
    const { authored, sources } = fixture()
    const other = buildStationInterior({ ...authored, stationId: 'U01', fetch: { ...authored.fetch }, platforms: [{ ...authored.platforms[0]!, tracks: authored.platforms[0]!.tracks.map((t) => ({ ...t, stopId: t.stopId.replace('T01', 'U01') })) }] }, sources)
    expect(() => buildStationDepths([complex, other])).toThrow(/station U01 has depths from two interiors/)
  })

  const g = toGround(ANCHOR)
  const line = (id: string, route: string, direction: 'N' | 'S', z: number): AnchorShape => {
    const pts = [{ x: g.x - 1000, z: g.z + z }, { x: g.x + 1000, z: g.z + z }]
    return { id, routeId: route, direction, line: buildPolyline(direction === 'N' ? pts : pts.reverse()) }
  }
  const shapes = [line('T..N', 'T', 'N', -2.5), line('T..S', 'T', 'S', 2.5), line('U..N', 'U', 'N', 47.5), line('U..S', 'U', 'S', 52.5)]
  const [uLat, uLon] = ll(0, 50)
  const stations: DepthsStations = {
    feedVersion: 'v1',
    stations: [
      { id: 'T01', lat: ANCHOR.lat, lon: ANCHOR.lon, stops: ['T01N', 'T01S'], routes: ['T'] },
      { id: 'U01', lat: uLat, lon: uLon, stops: ['U01N', 'U01S'], routes: ['U'] },
    ],
  }
  it('packs one entry per member and decodes both back to their runs', () => {
    const packed = packStationDepths(depths, stations, shapes)
    expect(packed.file.station).toHaveLength(2)
    expect(packed.notRidden).toEqual([])
    const members = [{ id: 'T01', routeIds: ['T'] }, { id: 'U01', routeIds: ['U'] }]
    const want = profileRuns(depths as StationDepthsFile, members, shapes).runs
    const got = profileRuns(decodeStationDepths(packed.file, stations, shapes).depths, members, shapes).runs
    expect([...want.keys()].sort()).toEqual(['T..N', 'T..S', 'U..N', 'U..S'])
    for (const [id, [run]] of want) {
      const [back] = got.get(id)!
      expect(back!.stationId, id).toBe(run!.stationId)
      expect(Math.abs(back!.d0 - run!.d0), id).toBeLessThanOrEqual(PACK_TOL_M)
      expect(Math.abs(back!.d1 - run!.d1), id).toBeLessThanOrEqual(PACK_TOL_M)
      expect(back!.yReal).toBeCloseTo(run!.yReal, 6)
    }
  })

  const { authored: plainAuthored, sources: plainSources } = fixture()
  const plain = buildStationInterior({ ...plainAuthored, stationId: 'L08', platforms: [{ ...plainAuthored.platforms[0]!, tracks: [] }], connectors: [], equipment: [], entrances: [], slabs: [] }, {
    ...plainSources,
    entrances: { ...plainSources.entrances, rows: [] },
    equipment: { ...plainSources.equipment, rows: [] },
  })
  it('indexes a member as an alias of the complex file, and every other entry as before', () => {
    expect(buildStationIndex([complex, plain]).stations).toEqual({
      L08: { provenance: 'authored' },
      T01: { provenance: 'authored' },
      U01: { provenance: 'authored', file: 'T01' },
    })
  })
  it('throws when a member has an interior of its own, or is in two complexes', () => {
    const own = { ...plain, stationId: 'U01' }
    expect(() => buildStationIndex([complex, own])).toThrow(/Duplicate interior for station U01/)
    const other = { ...complex, stationId: 'U01', memberStationIds: ['U01', 'V01'] }
    expect(() => buildStationIndex([complex, other])).toThrow(/Duplicate interior for station U01/)
  })
})
