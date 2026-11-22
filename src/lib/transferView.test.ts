import { describe, expect, it } from 'vitest'
import { complexFixture, without } from './complexFixture'
import { chooseTransfer, type TransferChoice } from './interiorTransfer'
import type { TripJourney, TripLeg } from './route/plan'
import { transferLegKey, transferLegs, transferLineView } from './transferView'

const base = complexFixture()

function ride(routeId: string, board: string, alight: string): TripLeg {
  return { kind: 'ride', routeId, tripId: `${routeId}-1`, patternKey: 'p', boardStop: board, alightStop: alight, terminalStop: 'XN', stops: [board, alight], departAt: 0, arriveAt: 60, live: false }
}
function walk(fromStop: string, toStop: string): TripLeg {
  return { kind: 'walk', fromStop, toStop, sameStation: false, startAt: 60, durationS: 180, endAt: 240 }
}
const journey = (legs: TripLeg[]): TripJourney => ({ departAt: 0, arriveAt: 600, transfers: 1, legs })

describe('transferLegs', () => {
  it('keys each walk between two rides by its stops and the next route, once, in journey order', () => {
    const a = journey([walk('A01N', 'L08N'), ride('L', 'L08N', 'L03N'), walk('L03N', 'R20N'), ride('N', 'R20N', 'R16N'), walk('R16N', 'R16N')])
    const b = journey([ride('L', 'L08N', 'L03N'), walk('L03N', 'R20N'), ride('Q', 'R20N', 'R16N')])
    const c = journey([ride('L', 'L08N', 'L03N'), walk('L03N', 'R20N'), ride('N', 'R20N', 'R16N')])
    expect(transferLegs([a, b, c])).toEqual([
      { key: 'L03N>R20N>N', fromStop: 'L03N', toStop: 'R20N', nextRouteId: 'N' },
      { key: 'L03N>R20N>Q', fromStop: 'L03N', toStop: 'R20N', nextRouteId: 'Q' },
    ])
    expect(transferLegKey({ fromStop: 'L03N', toStop: 'R20N' }, { routeId: 'N' })).toBe('L03N>R20N>N')
  })

  it('skips walks that start or end a journey, and rides with no walk between', () => {
    expect(transferLegs([journey([walk('A01N', 'L08N'), ride('L', 'L08N', 'L03N'), ride('N', 'L03N', 'R16N'), walk('R16N', 'B01N')])])).toEqual([])
  })
})

function choice(interior = base, fromStop = 'U01N', toStop = 'T01S'): TransferChoice {
  const r = chooseTransfer({ interior, fromStop, toStop })
  if (r.kind !== 'transfer') throw new Error(r.reason)
  return r
}

describe('transferLineView', () => {
  it('names the direct stair and the next train platform, with the step-free way under it', () => {
    expect(transferLineView(choice(), base, 'N', true)).toEqual({
      text: 'Stairs up to the N platform',
      note: null,
      stepFree: 'Step-free: elevators via the U mezzanine and the T mezzanine',
      spoken: 'Take the stairs up to the N platform. Step-free: elevators via the U mezzanine and the T mezzanine.',
    })
  })

  it('reads a way through the mezzanines in travel order, the passageway between', () => {
    const i = without(base, 'st-tu')
    const v = transferLineView(choice(i), i, 'FX', true)
    expect(v.text).toBe('Stairs up to the U mezzanine, then the passageway to the T mezzanine, then stairs down to the FX platform')
    expect(v.spoken).toMatch(/^Take the stairs up to the U mezzanine, then the passageway to the T mezzanine, then the stairs down to the F express platform\./)
  })

  it('merges consecutive steps of one kind and way, and calls a platform passed through another platform', () => {
    const route = { ...choice(), stepFreeAlt: null }
    const merged = { ...route, connectorIds: ['st-tu', 'st-t'], areaIds: ['island-u', 'island-t', 'mezz-t'] }
    expect(transferLineView(merged, base, 'N', true).text).toBe('Stairs up to the N platform')
    const mixed = { ...route, connectorIds: ['st-tu', 'EL-T'], areaIds: ['island-u', 'island-t', 'mezz-t'] }
    expect(transferLineView(mixed, base, 'N', true).text).toBe('Stairs up to another platform, then elevator up to the N platform')
    const passage = { ...route, connectorIds: ['wk-tu'], areaIds: ['mezz-u', 'mezz-t'] }
    expect(transferLineView(passage, base, 'N', true).text).toBe('The passageway to the N platform')
  })

  it('says a change on one platform is across the platform', () => {
    const v = transferLineView(choice(base, 'T01N', 'T01S'), base, 'N', true)
    expect(v).toEqual({ text: 'Across the platform', note: null, stepFree: null, spoken: 'Across the platform.' })
  })

  it('notes an unknown elevator status only when status is unknown and a route offered rides one', () => {
    expect(transferLineView(choice(), base, 'N', false).note).toBe('elevator status unknown')
    expect(transferLineView(choice(), base, 'N', false).spoken).toContain('Elevator status unknown.')
    const noLift = without(base, 'EL-T')
    expect(transferLineView(choice(noLift), noLift, 'N', false)).toMatchObject({ note: null, stepFree: null })
  })

  it('says probably on an estimated layout', () => {
    const i = { ...base, approximate: true as const }
    const v = transferLineView(choice(i), i, 'N', true)
    expect(v.note).toBe('probably')
    expect(v.spoken).toBe(
      'Take the stairs up to the N platform. Probably: the station layout is estimated. Step-free: elevators via the U mezzanine and the T mezzanine.',
    )
  })
})
