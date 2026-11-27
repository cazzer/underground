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

describe('the committed transfer walks', () => {
  it('are the few pairs between different complexes', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(1)
    expect(pairs.length).toBeLessThan(10)
  })

  it.each(pairs)('%s to %s routes along the streets, in either direction, within the detour cap', (a, b) => {
    const from = point(a)
    const to = point(b)
    const straight = Math.hypot(to.x - from.x, to.z - from.z)
    const there = transferWalkPath(from, to, a, b, graphs)
    const back = transferWalkPath(to, from, b, a, graphs)
    if (!there.ok || !back.ok) throw new Error(`${a} to ${b}: ${there.ok ? '' : there.reason} ${back.ok ? '' : back.reason}`)
    expect(there.meters).toBeGreaterThanOrEqual(straight - 1e-6)
    expect(there.meters).toBeLessThanOrEqual(straight * MAX_DETOUR)
    expect(there.path[0]).toEqual(from)
    expect(there.path[there.path.length - 1]).toEqual(to)
    expect(back.path).toEqual([...there.path].reverse())
  })
})
