import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationInterior } from '../../src/data/stationSchema.ts'
import { buildStationDepths, DEPTHS_OPEN_NY_NOTE } from './stationDepths.ts'
import { OPEN_NY_NOTE } from './stationMerge.ts'

// The committed station-depths.json is the packed form; depthsPack.test.ts checks it against every interior.
const l08 = JSON.parse(readFileSync(new URL('../../public/data/stations/L08.json', import.meta.url), 'utf8')) as StationInterior

describe('buildStationDepths', () => {
  it('puts the L08 rails 1.1 m below the platform (-9.1 m) and keeps the track ends', () => {
    const out = buildStationDepths([l08])
    expect(out.license).toBe('ODbL-1.0')
    expect(out.attribution[0]).toBe('© OpenStreetMap contributors')
    const [station] = out.stations
    expect(station?.stationId).toBe('L08')
    expect(station?.tracks.map((t) => t.stopId)).toEqual(['L08N', 'L08S'])
    for (const t of station!.tracks) {
      expect(t.railY).toBe(-10.2)
      const path = l08.platforms.flatMap((p) => p.tracks).find((x) => x.stopId === t.stopId)!.path
      expect(t.ends).toEqual([path[0], path.at(-1)])
    }
  })

  it('merges credits across stations with OSM first, and sorts stations by id', () => {
    const other: StationInterior = {
      ...l08,
      stationId: 'A01',
      attribution: ['Someone else', '© OpenStreetMap contributors'],
      platforms: l08.platforms.map((p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, stopId: t.stopId.replace('L08', 'A01') })) })),
    }
    const out = buildStationDepths([l08, other])
    expect(out.stations.map((s) => s.stationId)).toEqual(['A01', 'L08'])
    expect(out.attribution).toEqual(['© OpenStreetMap contributors', 'Someone else', 'Metropolitan Transportation Authority, data.ny.gov'])
  })

  it("drops the interiors' OPEN-NY note and adds its own only when a platform level's depth is an E&E rise", () => {
    expect(l08.attribution).toContain(OPEN_NY_NOTE)
    expect(buildStationDepths([l08]).attribution).not.toContain(OPEN_NY_NOTE)
    expect(buildStationDepths([l08]).attribution).not.toContain(DEPTHS_OPEN_NY_NOTE)
    const withSource = (depthSource: 'ee-rise' | 'osm-level'): StationInterior => ({
      ...l08,
      levels: l08.levels.map((l) => (l.kind === 'platform' ? { ...l, depthSource } : l)),
    })
    expect(buildStationDepths([withSource('ee-rise')]).attribution).toEqual([...buildStationDepths([l08]).attribution, DEPTHS_OPEN_NY_NOTE])
    expect(buildStationDepths([withSource('osm-level')]).attribution).not.toContain(DEPTHS_OPEN_NY_NOTE)
    // an ee-rise on a level no platform stands on contributes no rail height
    const mezzOnly: StationInterior = { ...l08, levels: l08.levels.map((l) => (l.kind === 'mezzanine' ? { ...l, depthSource: 'ee-rise' as const } : l)) }
    expect(buildStationDepths([mezzOnly]).attribution).not.toContain(DEPTHS_OPEN_NY_NOTE)
  })

  it('throws on a platform on an unknown level or a duplicated stop', () => {
    const p = l08.platforms[0]!
    expect(() => buildStationDepths([{ ...l08, platforms: [{ ...p, level: 'nowhere' }] }])).toThrow(/unknown level "nowhere"/)
    const twice = { ...p, tracks: [p.tracks[0]!, p.tracks[0]!] }
    expect(() => buildStationDepths([{ ...l08, platforms: [twice] }])).toThrow(/two tracks serve L08N/)
  })
})
