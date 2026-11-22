import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationsFile, TransfersFile } from '../../data/schema'
import { buildStopIndex, DEFAULT_CHANGE_S, stopsOfStations } from './stops'
import type { StopIndex } from './types'

const STOPS = ['101N', '101S', '102N', '102S', '104N', '104S', 'S03N', 'S03S']
const TRANSFERS = [
  { from: '104', to: 'S03', minTransferSec: 240 },
  { from: 'S03', to: '104', minTransferSec: 240 },
]

function build(overrides: { changeS?: Map<string, number>; transfers?: typeof TRANSFERS } = {}): StopIndex {
  return buildStopIndex({
    stopIds: STOPS,
    changeS: overrides.changeS ?? new Map(),
    transfers: overrides.transfers ?? TRANSFERS,
  })
}

function footpaths(index: StopIndex, stopId: string): Record<string, number> {
  const p = index.stopOf.get(stopId)!
  const out: Record<string, number> = {}
  for (let e = index.footStart[p]!; e < index.footStart[p + 1]!; e++) out[index.stopIds[index.footTo[e]!]!] = index.footS[e]!
  return out
}

describe('buildStopIndex', () => {
  it('walks to its own station (itself included) at the default change time', () => {
    expect(footpaths(build(), '102N')).toEqual({ '102N': DEFAULT_CHANGE_S, '102S': DEFAULT_CHANGE_S })
  })

  it('walks between linked stations at the transfer time, keeping the own-station change', () => {
    expect(footpaths(build(), '104N')).toEqual({
      '104N': 180,
      '104S': 180,
      S03N: 240,
      S03S: 240,
    })
  })

  it('uses a station change-time override and the smaller of duplicate transfers', () => {
    const index = build({
      changeS: new Map([['102', 60]]),
      transfers: [...TRANSFERS, { from: '104', to: 'S03', minTransferSec: 200 }],
    })
    expect(footpaths(index, '102S')).toEqual({ '102N': 60, '102S': 60 })
    expect(footpaths(index, '104S')['S03N']).toBe(200)
  })

  it('groups stops by station and sorts and dedupes them', () => {
    const index = buildStopIndex({ stopIds: [...STOPS, '102N'].reverse(), changeS: new Map(), transfers: [] })
    expect(index.stopIds).toEqual([...STOPS].sort())
    expect([...stopsOfStations(index, ['S03', '101'])].map((p) => index.stopIds[p])).toEqual(['S03N', 'S03S', '101N', '101S'])
  })

  it('throws on a bad suffix, an unknown station and bad seconds', () => {
    expect(() => buildStopIndex({ stopIds: ['101X'], changeS: new Map(), transfers: [] })).toThrow(/N or S/)
    expect(() => build({ transfers: [{ from: '104', to: 'ZZZ', minTransferSec: 60 }] })).toThrow(/ZZZ/)
    expect(() => build({ transfers: [{ from: '104', to: 'S03', minTransferSec: -1 }] })).toThrow(/seconds/)
    expect(() => build({ transfers: [{ from: '104', to: 'S03', minTransferSec: 1.5 }] })).toThrow(/seconds/)
    expect(() => build({ changeS: new Map([['ZZZ', 60]]) })).toThrow(/ZZZ/)
    expect(() => build({ changeS: new Map([['102', -5]]) })).toThrow(/seconds/)
    expect(() => stopsOfStations(build(), ['nope'])).toThrow(/unknown station/)
  })
})

describe('committed transfers', () => {
  const transfers = (JSON.parse(readFileSync('public/data/transfers.json', 'utf8')) as TransfersFile).transfers
  const linked = new Map<string, Set<string>>()
  for (const t of transfers) linked.set(t.from, (linked.get(t.from) ?? new Set()).add(t.to))

  // The router follows one footpath per round, so it relies on the data being symmetric and transitively closed
  // (a complex's stations all list each other): a transfer chain is never shorter than a direct one.
  it('are symmetric', () => {
    for (const t of transfers) expect(linked.get(t.to)?.has(t.from), `${t.to} lists ${t.from}`).toBe(true)
  })

  it('are transitively closed', () => {
    for (const [a, bs] of linked) {
      for (const b of bs) for (const c of linked.get(b) ?? []) if (c !== a) expect(bs.has(c), `${a} lists ${c}`).toBe(true)
    }
  })

  // Same reason: a two-step walk is never shorter than the direct transfer, so the one step per round is enough.
  it('obey the triangle inequality on transfer times', () => {
    const seconds = new Map(transfers.map((t) => [`${t.from}>${t.to}`, t.minTransferSec]))
    for (const [a, bs] of linked) {
      for (const b of bs) {
        for (const c of linked.get(b) ?? []) {
          if (c === a) continue
          expect(seconds.get(`${a}>${c}`)!, `${a} to ${c} via ${b}`).toBeLessThanOrEqual(seconds.get(`${a}>${b}`)! + seconds.get(`${b}>${c}`)!)
        }
      }
    }
  })

  it('build into an index with the real stations', () => {
    const { stations } = JSON.parse(readFileSync('public/data/stations.json', 'utf8')) as StationsFile
    const index = buildStopIndex({ stopIds: stations.flatMap((s) => s.stops), changeS: new Map(), transfers })
    expect(index.stationIds).toHaveLength(stations.length)
    expect(index.footTo.length).toBeGreaterThan(index.stopIds.length)
  })
})
