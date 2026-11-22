import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EneOutage, EneSnapshot } from '../../data/realtime'
import type { StationInterior } from '../../data/stationSchema'
import { closedForRouting, ENE_MAX_AGE_S, joinStationOutages } from './eneJoin'
import { noStepFreeNow } from './stepFreeLoss'

const l08 = JSON.parse(readFileSync(new URL('../../../public/data/stations/L08.json', import.meta.url), 'utf8')) as StationInterior
const NOW = 2_000_000

function closedAt(codes: string[], age = 0): ReadonlySet<string> | null {
  const outages: EneOutage[] = codes.map((code) => ({ code, reason: null, since: NOW - 60, returnAt: null }))
  const snapshot: EneSnapshot = { version: 1, generatedAt: NOW - age, dropped: 0, outages }
  const feed = { configured: true, snapshot, byCode: new Map(outages.map((o) => [o.code, o])), failures: 0, schemaMismatch: false }
  return closedForRouting(joinStationOutages(l08, feed, NOW))
}

describe('noStepFreeNow', () => {
  it('is true at an accessible station whose only step-free chain has an elevator out (L08: EL359 then EL358)', () => {
    expect(noStepFreeNow(l08, true, closedAt(['EL358']))).toBe(true)
    expect(noStepFreeNow(l08, true, closedAt(['EL359']))).toBe(true)
  })

  it('is false with nothing out', () => {
    expect(noStepFreeNow(l08, true, closedAt([]))).toBe(false)
  })

  it('is false when the outage is not at this interior', () => {
    expect(noStepFreeNow(l08, true, closedAt(['EL999']))).toBe(false)
  })

  it('is false when status is unknown (stale data): never a guess', () => {
    expect(closedAt(['EL358'], ENE_MAX_AGE_S + 1)).toBeNull()
    expect(noStepFreeNow(l08, true, closedAt(['EL358'], ENE_MAX_AGE_S + 1))).toBe(false)
  })

  it('is false for a station that is not accessible', () => {
    expect(noStepFreeNow(l08, false, closedAt(['EL358']))).toBe(false)
  })
})
