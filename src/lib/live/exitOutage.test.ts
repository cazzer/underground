import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EneOutage, EneSnapshot } from '../../data/realtime'
import type { StationInterior } from '../../data/stationSchema'
import { chooseExit } from '../exitChoice'
import { toGround } from '../projection'
import { closedForRouting, ENE_MAX_AGE_S, joinStationOutages } from './eneJoin'

const l08 = JSON.parse(readFileSync(new URL('../../../public/data/stations/L08.json', import.meta.url), 'utf8')) as StationInterior
const NOW = 2_000_000

function join(codes: string[], age = 0) {
  const outages: EneOutage[] = codes.map((code) => ({ code, reason: null, since: NOW - 60, returnAt: null }))
  const snapshot: EneSnapshot = { version: 1, generatedAt: NOW - age, dropped: 0, outages }
  return joinStationOutages(l08, { configured: true, snapshot, byCode: new Map(outages.map((o) => [o.code, o])), failures: 0, schemaMismatch: false }, NOW)
}

/** The step-free exit choice from the L08 platform, with the outage join's machines closed. */
function stepFreeExit(codes: string[]) {
  const closed = closedForRouting(join(codes))
  if (closed === null) throw new Error('outage status unknown')
  const here = toGround(l08.anchor)
  return chooseExit({ interior: l08, stopId: 'L08N', destination: { x: here.x + 40, z: here.z }, walk: null, stepFree: true, closed })
}

describe('step-free exit choice with outages', () => {
  it('reaches the street through the elevators when nothing is out', () => {
    expect(stepFreeExit([]).kind).toBe('exit')
  })

  it('has no way out when the platform elevator (the only step-free link) is out of service', () => {
    expect(stepFreeExit(['EL358'])).toEqual({ kind: 'none', reason: 'no-exit' })
  })

  it('has no way out when the mezzanine elevator is out', () => {
    expect(stepFreeExit(['EL359'])).toEqual({ kind: 'none', reason: 'no-exit' })
  })

  it('gives routing no closed set when the data is stale: status unknown, not "all working"', () => {
    expect(closedForRouting(join(['EL358'], ENE_MAX_AGE_S + 1))).toBeNull()
    expect(() => stepFreeExit(['EL358'])).not.toThrow()
  })

  it('ignores machines the join does not report as out', () => {
    expect(stepFreeExit(['EL999']).kind).toBe('exit')
  })
})
