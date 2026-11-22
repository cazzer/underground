import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Connector, StationInterior } from '../data/stationSchema'
import {
  CONTAINMENT_M, ELEVATOR_MPS, ELEVATOR_WAIT_S, endpointArea, ESCALATOR_MPS, routesToStreet, STAIR_MPS,
} from './interiorGraph'
import { fixture } from './interiorFixture'
import { WALK_SPEED_MPS } from './walkRoute'

const W = WALK_SPEED_MPS
const sources: Connector['sources'] = ['authored']

const PS1: Connector = {
  id: 'PS1', kind: 'stair', lower: { x: -10, z: 2, level: 'plat' }, upper: { x: -10, z: 8, level: 'mezz' }, width: 2, sources,
}
const ST1: Connector = {
  id: 'ST1', kind: 'stair', lower: { x: 0, z: 10, level: 'mezz' }, upper: { x: 7, z: 10, level: 'street' }, width: 2, sources,
}
const EL1: Connector = {
  id: 'EL1', kind: 'elevator', lower: { x: 3, z: 2.5, level: 'plat' }, upper: { x: 3, z: 2.5, level: 'mezz' }, width: 2, sources,
}
const EL2: Connector = {
  id: 'EL2', kind: 'elevator', lower: { x: 3, z: 10, level: 'mezz' }, upper: { x: 3, z: 10, level: 'street' }, width: 2, sources,
}

/** The shared mini interior with the mezzanine reaching x -15..15 from z = 2, so a stair from the platform lands on it. */
function interior(connectors: Connector[] = [PS1, ST1, EL1], over: Partial<StationInterior> = {}): StationInterior {
  const base = fixture(connectors)
  return {
    ...base,
    slabs: [{ ...base.slabs[0]!, outline: [[-15, 2], [15, 2], [15, 15], [-15, 15]] }],
    entrances: [{ ...base.entrances[0]!, x: 9, z: 10, connectors: ['ST1'] }],
    ...over,
  }
}

describe('endpointArea', () => {
  const it0 = interior()
  it('finds the platform or slab an endpoint stands in, and null on the street', () => {
    expect(endpointArea(it0, PS1.lower)).toBe('P1')
    expect(endpointArea(it0, PS1.upper)).toBe('S1')
    expect(endpointArea(it0, ST1.upper)).toBeNull()
  })
  it('accepts an endpoint just outside an outline, within CONTAINMENT_M, and rejects one farther', () => {
    expect(endpointArea(it0, { x: -10, z: 2 - 0.3, level: 'mezz' })).toBe('S1')
    expect(() => endpointArea(it0, { x: -10, z: 2 - 0.8, level: 'mezz' })).toThrow('on level "mezz"')
    expect(CONTAINMENT_M).toBe(0.5)
  })
  it('lets an authored area win, and rejects one that is not on the endpoint level', () => {
    expect(endpointArea(it0, { x: -30, z: 8, level: 'mezz', area: 'S1' })).toBe('S1')
    expect(() => endpointArea(it0, { x: -30, z: 8, level: 'mezz' })).toThrow()
    expect(() => endpointArea(it0, { x: -10, z: 8, level: 'mezz', area: 'P1' })).toThrow('names area "P1"')
  })
})

describe('routesToStreet', () => {
  it('chains the platform stair to the street stair, costed by slope and walks', () => {
    const [route, ...rest] = routesToStreet(interior(), 'X01N')!
    expect(rest).toEqual([])
    expect(route!.connectorIds).toEqual(['PS1', 'ST1'])
    expect(route!.areaIds).toEqual(['P1', 'S1'])
    expect(route!.exit).toEqual({ entranceId: 'E1', point: [9, 10], type: 'Stair' })
    expect(route!.platformPoint).toEqual([-10, 2])
    expect(route!.trackShare).toBeCloseTo(0.3, 12)
    const expected =
      7 / W + Math.hypot(6, 4) / STAIR_MPS + Math.hypot(10, 2) / W + Math.hypot(7, 4) / STAIR_MPS + 2 / W
    expect(route!.seconds).toBeCloseTo(expected, 9)
  })

  it('has no step-free route without an elevator to the street', () => {
    expect(routesToStreet(interior(), 'X01N', { stepFree: true })).toEqual([])
  })

  it('exits through an unlisted elevator at the street, with no entrance', () => {
    const [route, ...rest] = routesToStreet(interior([PS1, ST1, EL1, EL2]), 'X01N', { stepFree: true })!
    expect(rest).toEqual([])
    expect(route!.connectorIds).toEqual(['EL1', 'EL2'])
    expect(route!.exit).toEqual({ entranceId: null, point: [3, 10], type: null })
    expect(route!.areaIds).toEqual(['P1', 'S1'])
    const expected = 7.5 / W + (ELEVATOR_WAIT_S + 4 / ELEVATOR_MPS) + 7.5 / W + (ELEVATOR_WAIT_S + 4 / ELEVATOR_MPS)
    expect(route!.seconds).toBeCloseTo(expected, 9)
  })

  it('skips a closed connector', () => {
    const it4 = interior([PS1, ST1, EL1, EL2])
    expect(routesToStreet(it4, 'X01N', { stepFree: true, closed: new Set(['EL1']) })).toEqual([])
    expect(routesToStreet(it4, 'X01N', { closed: new Set(['EL1']) })!.map((r) => r.connectorIds)).toEqual([['PS1', 'ST1'], ['PS1', 'EL2']])
  })

  it('returns null for a stop with no track', () => {
    expect(routesToStreet(interior(), 'X01S')).toBeNull()
  })

  it('never exits through an entrance that is not an exit', () => {
    const base = interior()
    const it5 = { ...base, entrances: [{ ...base.entrances[0]!, exit: false }] }
    expect(routesToStreet(it5, 'X01N')).toEqual([])
  })

  it.each([
    ['down', []],
    ['up', [['ES1', 'ST1']]],
    [undefined, [['ES1', 'ST1']]],
  ] as const)('runs an escalator travelling %s only that way', (travel, chains) => {
    const ES1: Connector = { id: 'ES1', kind: 'escalator', lower: PS1.lower, upper: PS1.upper, width: 2, sources, ...(travel && { travel }) }
    expect(routesToStreet(interior([ES1, ST1]), 'X01N')!.map((r) => r.connectorIds)).toEqual(chains)
  })

  it('gives a zero-run escalator a 30 degree run (rise x sqrt 3) for its slope', () => {
    const ES1: Connector = { id: 'ES1', kind: 'escalator', lower: { x: -10, z: 2, level: 'plat' }, upper: { x: -10, z: 2, level: 'mezz' }, width: 2, sources }
    const [route] = routesToStreet(interior([ES1, ST1]), 'X01N')!
    const slope = Math.hypot(4 * Math.sqrt(3), 4)
    expect(route!.seconds).toBeCloseTo(7 / W + slope / ESCALATOR_MPS + Math.hypot(10, 8) / W + Math.hypot(7, 4) / STAIR_MPS + 2 / W, 9)
  })

  it('crosses a walkway between two slabs, in step-free mode too', () => {
    const S2 = { id: 'S2', level: 'mezz', name: 'East', outline: [[20, 2], [30, 2], [30, 15], [20, 15]] as [number, number][], sources }
    const base = interior()
    const W1: Connector = {
      id: 'W1', kind: 'walkway', lower: { x: 14, z: 8, level: 'mezz', area: 'S1' }, upper: { x: 21, z: 8, level: 'mezz', area: 'S2' }, width: 2, sources,
    }
    const EL3: Connector = { id: 'EL3', kind: 'elevator', lower: { x: 25, z: 8, level: 'mezz' }, upper: { x: 25, z: 8, level: 'street' }, width: 2, sources }
    const it6 = { ...base, slabs: [...base.slabs, S2], connectors: [PS1, EL1, W1, EL3] }
    const [route] = routesToStreet(it6, 'X01N', { stepFree: true })!
    expect(route!.connectorIds).toEqual(['EL1', 'W1', 'EL3'])
    expect(route!.areaIds).toEqual(['P1', 'S1', 'S2'])
    expect(route!.seconds).toBeCloseTo(
      7.5 / W + (ELEVATOR_WAIT_S + 4) + Math.hypot(11, 5.5) / W + 7 / W + 4 / W + (ELEVATOR_WAIT_S + 4),
      9,
    )
  })
})

describe('routesToStreet at Bedford Av', () => {
  const l08 = JSON.parse(readFileSync('public/data/stations/L08.json', 'utf8')) as StationInterior
  const byEntrance = (stop: string, opts = {}) => new Map((routesToStreet(l08, stop, opts) ?? []).map((r) => [r.exit.entranceId, r]))

  it('reaches all nine entrances from either track', () => {
    expect(byEntrance('L08N').size).toBe(9)
    expect(byEntrance('L08S').size).toBe(9)
  })

  it.each([
    ['bedford-ne-1', ['st-platform-west-2', 'st-bedford-ne-1'], ['island', 'mezz-bedford']],
    ['driggs-nw-1', ['st-platform-east', 'st-driggs-nw-1'], ['island', 'mezz-driggs']],
  ])('chains the platform to %s', (entrance, connectors, areas) => {
    for (const stop of ['L08N', 'L08S']) {
      const route = byEntrance(stop).get(entrance)!
      expect(route.connectorIds).toEqual(connectors)
      expect(route.areaIds).toEqual(areas)
    }
  })

  it('has one step-free route, through the Bedford elevators', () => {
    const routes = [...byEntrance('L08N', { stepFree: true }).values()]
    expect(routes.map((r) => r.exit.entranceId)).toEqual(['bedford-ne-elevator'])
    expect(routes[0]!.connectorIds).toEqual(['EL358', 'EL359'])
  })

  it('sorts routes by time', () => {
    const seconds = routesToStreet(l08, 'L08N')!.map((r) => r.seconds)
    expect(seconds).toEqual([...seconds].sort((a, b) => a - b))
  })
})
