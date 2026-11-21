import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationDepthsFile, StationInterior } from '../../src/data/stationSchema.ts'
import { toStableJson } from './stableJson.ts'
import { buildStationDepths } from './stationDepths.ts'

const interiorDir = new URL('../../public/data/stations/', import.meta.url)
const interiors = readdirSync(interiorDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(new URL(f, interiorDir), 'utf8')) as StationInterior)
const l08 = interiors.find((i) => i.stationId === 'L08')!
const committed = readFileSync(new URL('../../public/data/station-depths.json', import.meta.url), 'utf8')

describe('buildStationDepths', () => {
  it('matches the committed station-depths.json (rerun npm run data:stations if not)', () => {
    expect(interiors.length).toBeGreaterThan(0)
    expect(toStableJson(buildStationDepths(interiors), 2)).toBe(committed)
  })

  it('puts the L08 rails 1.1 m below the platform (-9.1 m) and keeps the track ends', () => {
    const out = JSON.parse(committed) as StationDepthsFile
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
    const other: StationInterior = { ...l08, stationId: 'A01', attribution: ['Someone else', '© OpenStreetMap contributors'] }
    const out = buildStationDepths([l08, other])
    expect(out.stations.map((s) => s.stationId)).toEqual(['A01', 'L08'])
    expect(out.attribution).toEqual(['© OpenStreetMap contributors', 'Someone else', 'Metropolitan Transportation Authority, data.ny.gov'])
  })

  it('throws on a platform on an unknown level or a duplicated stop', () => {
    const p = l08.platforms[0]!
    expect(() => buildStationDepths([{ ...l08, platforms: [{ ...p, level: 'nowhere' }] }])).toThrow(/unknown level "nowhere"/)
    const twice = { ...p, tracks: [p.tracks[0]!, p.tracks[0]!] }
    expect(() => buildStationDepths([{ ...l08, platforms: [twice] }])).toThrow(/two tracks serve L08N/)
  })
})
