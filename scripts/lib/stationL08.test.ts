/** Checks on the committed Bedford Av files. No network: the sources are the pinned extract. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toGround } from '../../src/lib/projection.ts'
import type { StationInterior } from '../../src/data/stationSchema.ts'
import type { AuthoredStation, StationSources } from './stationInputs.ts'
import { buildStationInterior } from './stationMerge.ts'
import { toStableJson } from './stableJson.ts'

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const authored = JSON.parse(read('data/stations/L08.authored.json')) as AuthoredStation
const sources = JSON.parse(read('data/stations/L08.sources.json')) as StationSources
const committed = read('public/data/stations/L08.json')
const out = JSON.parse(committed) as StationInterior

const yOf = (id: string) => out.levels.find((l) => l.id === id)!.y
const connector = (id: string) => out.connectors.find((c) => c.id === id)!
const stairs = out.connectors.filter((c) => c.kind === 'stair')
const between = (a: string, b: string) => stairs.filter((c) => c.lower.level === a && c.upper.level === b)

describe('committed L08 interior', () => {
  it('is fresh: the merge of the committed inputs reproduces public/data/stations/L08.json byte for byte', () => {
    expect(toStableJson(buildStationInterior(authored, sources), 2)).toBe(committed)
  })
  it('has street > mezzanine > platform at plausible depths', () => {
    expect(out.levels.map((l) => l.id)).toEqual(['street', 'mezzanine', 'platform'])
    expect(yOf('street')).toBe(0)
    expect(yOf('platform')).toBeLessThan(yOf('mezzanine'))
  })
  it('has one island platform with L08N and L08S 3-7 m from its long axis, on opposite sides', () => {
    expect(out.platforms).toHaveLength(1)
    const p = out.platforms[0]!
    expect(p.level).toBe('platform')
    // Long axis: the line through the midpoints of the two shortest edges of the outline.
    const edges = p.outline.map((pt, i) => [pt, p.outline[(i + 1) % p.outline.length]!] as const)
    const [m1, m2] = edges
      .sort((e, f) => Math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1]) - Math.hypot(f[1][0] - f[0][0], f[1][1] - f[0][1]))
      .slice(0, 2)
      .map(([u, v]) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2] as const) as [readonly [number, number], readonly [number, number]]
    const len = Math.hypot(m2[0] - m1[0], m2[1] - m1[1])
    const offset = (pt: readonly [number, number]) => ((m2[0] - m1[0]) * (pt[1] - m1[1]) - (m2[1] - m1[1]) * (pt[0] - m1[0])) / len
    const offsets = Object.fromEntries(p.tracks.map((t) => [t.stopId, offset(t.path[0]!)]))
    expect(Object.keys(offsets).sort()).toEqual(['L08N', 'L08S'])
    expect(Math.sign(offsets.L08N!)).toBe(-Math.sign(offsets.L08S!))
    for (const d of Object.values(offsets)) expect(Math.abs(d)).toBeGreaterThan(3)
    for (const d of Object.values(offsets)) expect(Math.abs(d)).toBeLessThan(7)
  })
  it('has two mezzanine slabs', () => {
    expect(out.slabs.map((s) => s.level)).toEqual(['mezzanine', 'mezzanine'])
  })
  it('runs EL358 platform to mezzanine and EL359 mezzanine to street, linked to the Elevator entrance', () => {
    expect([connector('EL358').lower.level, connector('EL358').upper.level]).toEqual(['platform', 'mezzanine'])
    expect([connector('EL359').lower.level, connector('EL359').upper.level]).toEqual(['mezzanine', 'street'])
    const elevatorEntrance = out.entrances.find((e) => e.type === 'Elevator')!
    expect(elevatorEntrance.connectors).toEqual(['EL359'])
  })
  it('has 3 platform stairs, 8 street stairs, and 9 entrances each reached by a connector', () => {
    expect(between('platform', 'mezzanine')).toHaveLength(3)
    expect(between('mezzanine', 'street')).toHaveLength(8)
    expect(out.entrances).toHaveLength(9)
    for (const e of out.entrances) expect(e.connectors.length).toBeGreaterThanOrEqual(1)
  })
  it('keeps the EL359 override within 15 m of the raw E&E point', () => {
    const raw = sources.equipment.rows.find((r) => r.code === 'EL359')!
    const g = toGround(raw, authored.frame.anchor)
    const { x, z } = connector('EL359').upper
    expect(Math.hypot(g.x - x, g.z - z)).toBeLessThan(15)
  })
})
