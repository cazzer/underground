/** Transfers through the committed Union Sq complex (635: the 4/5/6, L and N/Q/R/W platforms). */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationInterior } from '../data/stationSchema'
import { STEP_FREE_KINDS } from './interiorGraphCore'
import { chooseTransfer } from './interiorTransfer'

const interior = JSON.parse(readFileSync('public/data/stations/635.json', 'utf8')) as StationInterior
const stops = [...new Set(interior.platforms.flatMap((p) => p.tracks.map((t) => t.stopId)))].sort()
const kindOf = (id: string) => interior.connectors.find((c) => c.id === id)!.kind

describe('transfers at Union Sq', () => {
  it('takes the direct stairs from the L up to each Broadway platform', () => {
    for (const from of ['L03N', 'L03S']) {
      for (const [to, stair] of [['R20N', 'st-509025053'], ['R20S', 'st-509025055']] as const) {
        const t = chooseTransfer({ interior, fromStop: from, toStop: to })
        expect(t.kind === 'transfer' && t.connectorIds, `${from} > ${to}`).toEqual([stair])
      }
    }
  })

  it('offers a step-free way from the L to the uptown Broadway platform, by elevators and the walkway', () => {
    const t = chooseTransfer({ interior, fromStop: 'L03N', toStop: 'R20N' })
    if (t.kind !== 'transfer') throw new Error(t.reason)
    const alt = t.stepFreeAlt
    expect(alt?.connectorIds).toEqual(['EL218', 'walk-bmt-irt', 'EL219'])
    expect(alt!.connectorIds.every((id) => STEP_FREE_KINDS.has(kindOf(id)))).toBe(true)
    // The router's change time at Union Sq is transfers.json's 180 s; the graph's own times, for the record.
    console.info(`Union Sq L03N > R20N: ${t.inStationS.toFixed(0)} s by stairs, ${alt!.seconds.toFixed(0)} s step-free via ${alt!.areaIds.join(', ')}`)
  })

  it('returns for every pair of stops at different members, always probable (an approximate layout)', () => {
    const member = (stop: string) => stop.slice(0, -1)
    let found = 0
    for (const from of stops) {
      for (const to of stops) {
        if (member(from) === member(to)) continue
        const t = chooseTransfer({ interior, fromStop: from, toStop: to })
        if (t.kind !== 'transfer') continue
        expect(t.probable, `${from} > ${to}`).toBe(true)
        expect(t.areaIds.length, `${from} > ${to}`).toBe(t.connectorIds.length + 1)
        found++
      }
    }
    // 6 stops at three members: 24 ordered pairs at different members, all connected inside fare control.
    expect(found).toBe(24)
  })
})
