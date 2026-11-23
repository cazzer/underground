import { describe, expect, it } from 'vitest'
import type { Station } from './network'
import { tripMarks, tripStationIds, type MarkLeg } from './tripMarks'
import { stopStations } from './tripSpans'

function station(id: string, x: number, leadId = id): Station {
  return { id, name: id, pos: { x, z: 0 }, routeIds: [], stops: [`${id}N`, `${id}S`], access: { status: 'none' }, leadId }
}
// T1 and T2 are one complex (lead T1).
const stops = stopStations([station('A', 0), station('B', 100), station('C', 200), station('D', 300), station('T1', 400), station('T2', 450, 'T1')])
const ride = (...s: string[]): MarkLeg => ({ kind: 'ride', stops: s })
const walk = (fromStop: string, toStop: string): MarkLeg => ({ kind: 'walk', fromStop, toStop })
const roles = (legs: MarkLeg[]) => tripMarks(legs, stops).map((m) => `${m.stationId}:${m.role}`)

describe('tripMarks', () => {
  it('marks one ride at its board and alight stations', () => {
    expect(roles([ride('AN', 'BN', 'CN')])).toEqual(['A:start', 'C:end'])
    expect(tripMarks([ride('AN', 'BN')], stops)[0]!.pos).toEqual({ x: 0, z: 0 })
  })

  it('marks a change inside one station once', () => {
    expect(roles([ride('AN', 'BN'), walk('BN', 'BS'), ride('BS', 'CS')])).toEqual(['A:start', 'B:change', 'C:end'])
    expect(roles([ride('AN', 'BN'), ride('BN', 'CN')])).toEqual(['A:start', 'B:change', 'C:end'])
  })

  it('marks both ends of a walk between stations as changes', () => {
    expect(roles([ride('AN', 'BN'), walk('BN', 'CS'), ride('CS', 'DS')])).toEqual(['A:start', 'B:change', 'C:change', 'D:end'])
  })

  it("starts at a leading walk's origin and ends at a trailing walk's end", () => {
    expect(roles([walk('AN', 'BN'), ride('BN', 'CN'), walk('CN', 'DN')])).toEqual(['A:start', 'B:change', 'C:change', 'D:end'])
  })

  it('marks a walk-only journey at its two ends', () => {
    expect(roles([walk('AN', 'BN')])).toEqual(['A:start', 'B:end'])
  })

  it("keeps a mark on each complex member a walk joins", () => {
    expect(roles([ride('AN', 'T1N'), walk('T1N', 'T2S'), ride('T2S', 'DS')])).toEqual(['A:start', 'T1:change', 'T2:change', 'D:end'])
  })

  it('lets start or end win over change at the same station', () => {
    expect(roles([ride('AN', 'BN'), ride('BS', 'AS')])).toEqual(['A:start', 'B:change'])
  })

  it('throws for a stop no station lists, and marks nothing for no legs', () => {
    expect(() => tripMarks([ride('AN', 'ZN')], stops)).toThrow(/ZN/)
    expect(tripMarks([], stops)).toEqual([])
  })
})

describe('tripStationIds', () => {
  it('lists every station called at, passed through or walked to, once each in journey order', () => {
    expect(tripStationIds([ride('AN', 'BN', 'CN'), walk('CN', 'T2S'), ride('T2S', 'DS'), ride('DS', 'AS')], stops)).toEqual(['A', 'B', 'C', 'T2', 'D'])
  })

  it('throws for an unknown stop', () => {
    expect(() => tripStationIds([walk('AN', 'ZZ')], stops)).toThrow(/ZZ/)
  })
})
