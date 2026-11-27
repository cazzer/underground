/**
 * The cross-complex transfer walks (85r) on the committed data: there are three today, each routes on the committed
 * walk shards, and a street path is never shorter than the straight line nor past the detour cap. Properties, not
 * lengths: the daily refresh moves the data.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeStationWalk } from '../data/loadStationWalk'
import type { StationsFile, TransfersFile } from '../data/schema'
import type { StationWalk, WalkGraph } from '../data/walkSchema'
import { toGround } from './projection'
import { transferPairStations, transferStationIds } from './transferPairs'
import { MAX_DETOUR, transferWalkPath } from './tripWalkPaths'

const read = <T>(path: string): T => JSON.parse(readFileSync(`public/data/${path}`, 'utf8')) as T
const stations = read<StationsFile>('stations.json')
const leads = new Map<string, string>()
for (const complex of stations.complexes ?? []) for (const m of complex) leads.set(m, complex[0]!)
const pairs = transferPairStations(read<TransfersFile>('route/transfers.json').transfers, (id) => leads.get(id) ?? id)
const graphs = new Map<string, WalkGraph>(
  transferStationIds(pairs).map((id) => [id, decodeStationWalk(read<StationWalk>(`walk/${id}.json`))]),
)
const point = (id: string) => {
  const s = stations.stations.find((x) => x.id === id)
  if (!s) throw new Error(`no station ${id}`)
  return toGround(s)
}

/** A pair with no street path falls back to the straight dash at runtime (warned), so the data may move without failing here. */
const routed = pairs.flatMap(([a, b]) => {
  const from = point(a)
  const to = point(b)
  const there = transferWalkPath(from, to, a, b, graphs)
  const back = transferWalkPath(to, from, b, a, graphs)
  return there.ok && back.ok ? [{ a, b, from, to, there, back }] : []
})

describe('the committed transfer walks', () => {
  it('are a few pairs between different complexes (a generous bound, not a count)', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(1)
    expect(pairs.length).toBeLessThan(50)
  })

  it('route along the streets for at least one pair', () => {
    expect(routed.length).toBeGreaterThanOrEqual(1)
  })

  it.each(routed.map((r) => [r.a, r.b, r] as const))('%s to %s: never shorter than the line, within the detour cap, ends on the stations, the same path back', (_a, _b, r) => {
    const straight = Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z)
    expect(r.there.meters).toBeGreaterThanOrEqual(straight - 1e-6)
    expect(r.there.meters).toBeLessThanOrEqual(straight * MAX_DETOUR)
    expect(r.there.path[0]).toEqual(r.from)
    expect(r.there.path[r.there.path.length - 1]).toEqual(r.to)
    expect(r.back.path).toEqual([...r.there.path].reverse())
  })
})
