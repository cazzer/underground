import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Connector, StationInterior } from '../data/stationSchema'
import { ELEVATOR_MPS, ELEVATOR_WAIT_S, routesFromStreet, routesToStreet, STAIR_MPS } from './interiorGraph'
import { escalatorsAgainstTravel } from './interiorGraphEntryCheck'
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

/** interiorGraph.test.ts's mini interior: the mezzanine reaches x -15..15 from z = 2. */
function interior(connectors: Connector[] = [PS1, ST1, EL1], over: Partial<StationInterior> = {}): StationInterior {
  const base = fixture(connectors)
  return {
    ...base,
    slabs: [{ ...base.slabs[0]!, outline: [[-15, 2], [15, 2], [15, 15], [-15, 15]] }],
    entrances: [{ ...base.entrances[0]!, x: 9, z: 10, connectors: ['ST1'] }],
    ...over,
  }
}

describe('routesFromStreet', () => {
  it('lists the route platform first, timed as the way out over two-way connectors', () => {
    const [route, ...rest] = routesFromStreet(interior(), 'X01N')!
    expect(rest).toEqual([])
    expect(route!.connectorIds).toEqual(['PS1', 'ST1'])
    expect(route!.areaIds).toEqual(['P1', 'S1'])
    expect(route!.exit).toEqual({ entranceId: 'E1', point: [9, 10], type: 'Stair' })
    expect(route!.platformPoint).toEqual([-10, 2])
    const expected = 7 / W + Math.hypot(6, 4) / STAIR_MPS + Math.hypot(10, 2) / W + Math.hypot(7, 4) / STAIR_MPS + 2 / W
    expect(route!.seconds).toBeCloseTo(expected, 9)
  })

  it.each([
    // Coming in, the rider rides from the mezzanine down to the platform.
    ['down', [['ES1', 'ST1']]],
    ['up', []],
    [undefined, [['ES1', 'ST1']]],
  ] as const)('rides an escalator travelling %s only that way', (travel, chains) => {
    const ES1: Connector = { id: 'ES1', kind: 'escalator', lower: PS1.lower, upper: PS1.upper, width: 2, sources, ...(travel && { travel }) }
    expect(routesFromStreet(interior([ES1, ST1]), 'X01N')!.map((r) => r.connectorIds)).toEqual(chains)
  })

  it('enters only by an entrance marked entry, whatever its exit flag', () => {
    const base = interior()
    const exitOnly = { ...base, entrances: [{ ...base.entrances[0]!, entry: false }] }
    expect(routesFromStreet(exitOnly, 'X01N')).toEqual([])
    const entryOnly = { ...base, entrances: [{ ...base.entrances[0]!, exit: false }] }
    expect(routesFromStreet(entryOnly, 'X01N')!.map((r) => r.exit.entranceId)).toEqual(['E1'])
  })

  it('skips closed connectors and goes step-free through the elevators', () => {
    const it4 = interior([PS1, ST1, EL1, EL2])
    const [route] = routesFromStreet(it4, 'X01N', { stepFree: true })!
    expect(route!.connectorIds).toEqual(['EL1', 'EL2'])
    expect(route!.exit).toEqual({ entranceId: null, point: [3, 10], type: null })
    expect(route!.seconds).toBeCloseTo(7.5 / W + (ELEVATOR_WAIT_S + 4 / ELEVATOR_MPS) + 7.5 / W + (ELEVATOR_WAIT_S + 4 / ELEVATOR_MPS), 9)
    expect(routesFromStreet(it4, 'X01N', { stepFree: true, closed: new Set(['EL2']) })).toEqual([])
  })

  it('returns null for a stop with no track', () => {
    expect(routesFromStreet(interior(), 'X01S')).toBeNull()
  })
})

const load = (id: string) => JSON.parse(readFileSync(`public/data/stations/${id}.json`, 'utf8')) as StationInterior

describe('routesFromStreet at Bedford Av', () => {
  const l08 = load('L08')
  const byEntrance = (stop: string, opts = {}) => new Map((routesFromStreet(l08, stop, opts) ?? []).map((r) => [r.exit.entranceId, r]))

  it('reaches either track from all nine entrances, in the way out times (no one-way machines there)', () => {
    for (const stop of ['L08N', 'L08S']) {
      const into = byEntrance(stop)
      expect(into.size, stop).toBe(9)
      for (const out of routesToStreet(l08, stop)!) {
        const route = into.get(out.exit.entranceId)!
        expect(route.connectorIds, out.exit.entranceId ?? '').toEqual(out.connectorIds)
        expect(route.seconds).toBeCloseTo(out.seconds, 9)
      }
    }
  })

  it('goes step-free through the Bedford elevators, and nowhere with EL358 out', () => {
    const routes = [...byEntrance('L08N', { stepFree: true }).values()]
    expect(routes.map((r) => r.exit.entranceId)).toEqual(['bedford-ne-elevator'])
    expect(routes[0]!.connectorIds).toEqual(['EL358', 'EL359'])
    expect(routesFromStreet(l08, 'L08N', { stepFree: true, closed: new Set(['EL358']) })).toEqual([])
  })
})

describe('routesFromStreet at Union Sq', () => {
  const u = load('635')

  it('never reaches the Canarsie platform up ES219, nor in by the up escalator ES257X', () => {
    for (const stop of ['L03N', 'L03S']) {
      const routes = routesFromStreet(u, stop)!
      expect(routes.length, stop).toBeGreaterThan(0)
      for (const r of routes) {
        expect(r.connectorIds, stop).not.toContain('ES219')
        expect(r.connectorIds, stop).not.toContain('ES257X')
      }
      expect(escalatorsAgainstTravel(u, routes)).toEqual([])
    }
  })

  it('comes in at the Zeckendorf easement by the down escalator or the elevator', () => {
    const zeck = routesFromStreet(u, 'L03N')!.find((r) => r.exit.entranceId === 'e-zeckendorf-14')!
    expect(zeck.connectorIds.at(-1)).toMatch(/^(ES258X|EL217)$/)
  })

  it('while the way out there can ride the up escalators', () => {
    const out = routesToStreet(u, 'L03N')!
    expect(out.some((r) => r.connectorIds.includes('ES219') || r.connectorIds.includes('ES257X'))).toBe(true)
    // Read as ways in, those routes would ride them down: the check catches it.
    expect(escalatorsAgainstTravel(u, out)).toContain('ES219 ridden down')
  })

  it('reaches the Canarsie platform step-free through EL217 and EL218', () => {
    for (const stop of ['L03N', 'L03S']) expect(routesFromStreet(u, stop, { stepFree: true })![0]?.connectorIds, stop).toEqual(['EL218', 'EL217'])
  })
})
