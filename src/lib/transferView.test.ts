import { describe, expect, it } from 'vitest'
import { complexFixture, without, withSlab } from './complexFixture'
import { chooseTransfer, type TransferChoice } from './interiorTransfer'
import type { TripJourney, TripLeg } from './route/plan'
import { journeyTransferDraws, isChangeWalk, transferLegKey, transferLegs, transferLineView } from './transferView'

const base = complexFixture()
const NAMES: Record<string, string> = { L03: '14 St-Union Sq', R20: '14 St-Union Sq', '635': '14 St-Union Sq' }
const stationName = (id: string) => NAMES[id] ?? id

function ride(routeId: string, board: string, alight: string): TripLeg {
  return { kind: 'ride', routeId, tripId: `${routeId}-1`, patternKey: 'p', boardStop: board, alightStop: alight, terminalStop: 'XN', stops: [board, alight], departAt: 0, arriveAt: 60, live: false }
}
function walk(fromStop: string, toStop: string, sameStation = false): TripLeg {
  return { kind: 'walk', fromStop, toStop, sameStation, startAt: 60, durationS: 180, endAt: 240 }
}
const journey = (legs: TripLeg[]): TripJourney => ({ departAt: 0, arriveAt: 600, transfers: 1, legs })

describe('transferLegs', () => {
  it('keys each change row by its stops and the next route, once, in journey order', () => {
    const a = journey([walk('A01N', 'L08N'), ride('L', 'L08N', 'L03N'), walk('L03N', 'R20N'), ride('N', 'R20N', 'R16N'), walk('R16N', 'R16N')])
    const b = journey([ride('L', 'L08N', 'L03N'), walk('L03N', 'R20N'), ride('Q', 'R20N', 'R16N')])
    const c = journey([ride('L', 'L08N', 'L03N'), walk('L03N', 'R20N'), ride('N', 'R20N', 'R16N')])
    expect(transferLegs([a, b, c], stationName)).toEqual([
      { key: 'L03N>R20N>N', fromStop: 'L03N', toStop: 'R20N', nextRouteId: 'N' },
      { key: 'L03N>R20N>Q', fromStop: 'L03N', toStop: 'R20N', nextRouteId: 'Q' },
    ])
    expect(transferLegKey({ fromStop: 'L03N', toStop: 'R20N' }, { routeId: 'N' })).toBe('L03N>R20N>N')
  })

  it('skips walks that start or end a journey, rides with no walk between, and walks between stations', () => {
    expect(transferLegs([journey([walk('A01N', 'L08N'), ride('L', 'L08N', 'L03N'), ride('N', 'L03N', 'R16N'), walk('R16N', 'B01N')])], stationName)).toEqual([])
    expect(transferLegs([journey([ride('L', 'L08N', 'L03N'), walk('L03N', 'A01N'), ride('A', 'A01N', 'A02N')])], stationName)).toEqual([])
    expect(isChangeWalk({ fromStop: 'L03N', toStop: 'A01N', sameStation: true }, stationName)).toBe(true)
  })
})

function choice(interior = base, fromStop = 'U01N', toStop = 'T01S', closed?: ReadonlySet<string>): TransferChoice {
  const r = chooseTransfer({ interior, fromStop, toStop, closed })
  if (r.kind !== 'transfer') throw new Error(r.reason)
  return r
}

describe('journeyTransferDraws', () => {
  const stair = choice()
  const across = choice(base, 'T01N', 'T01S')
  const all = new Set(['a', 'b', 'c', 'd'])
  it('draws per interior the first listed change, and none when that one takes no connector', () => {
    const legs = [
      { file: '635', key: 'a', c: across },
      { file: '635', key: 'b', c: stair },
      { file: 'L08', key: 'c', c: stair },
      { file: 'L08', key: 'd', c: across },
    ]
    expect(journeyTransferDraws(legs, all, (l) => l.c)).toEqual([{ interiorId: 'L08', choice: stair }])
    expect(journeyTransferDraws([{ file: '635', key: 'a', c: null }, { file: '635', key: 'b', c: stair }], all, (l) => l.c)).toEqual([])
  })

  it("draws only the listed journey's changes", () => {
    const legs = [
      { file: '635', key: 'a', c: stair },
      { file: 'L08', key: 'c', c: stair },
    ]
    expect(journeyTransferDraws(legs, new Set(['c']), (l) => l.c)).toEqual([{ interiorId: 'L08', choice: stair }])
    expect(journeyTransferDraws(legs, new Set(), (l) => l.c)).toEqual([])
  })
})

describe('transferLineView', () => {
  it('names the direct stair and the next train platform, with the step-free way under it', () => {
    expect(transferLineView(choice(), base, 'N', true)).toEqual({
      text: 'Stairs up to the N platform',
      probably: false,
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
    const route = { ...choice(), stepFreeAlt: null, noStepFree: null }
    const merged = { ...route, connectorIds: ['st-tu', 'st-t'], areaIds: ['island-u', 'island-t', 'mezz-t'] }
    expect(transferLineView(merged, base, 'N', true).text).toBe('Stairs up to the N platform')
    const mixed = { ...route, connectorIds: ['st-tu', 'EL-T'], areaIds: ['island-u', 'island-t', 'mezz-t'] }
    expect(transferLineView(mixed, base, 'N', true).text).toBe('Stairs up to another platform, then elevator up to the N platform')
    const passage = { ...route, connectorIds: ['wk-tu'], areaIds: ['mezz-u', 'mezz-t'] }
    expect(transferLineView(passage, base, 'N', true).text).toBe('The passageway to the N platform')
    // A connector with no end where the walk stands is a data error, not a guess.
    expect(() => transferLineView({ ...route, connectorIds: ['st-t'], areaIds: ['island-u', 'island-t'] }, base, 'N', true)).toThrow('no end in island-u')
  })

  it('says a change on one platform is across the platform, or the same platform for the same stop', () => {
    const v = transferLineView(choice(base, 'T01N', 'T01S'), base, 'N', true)
    expect(v).toEqual({ text: 'Across the platform', probably: false, note: null, stepFree: null, spoken: 'Across the platform.' })
    expect(transferLineView(choice(base, 'T01N', 'T01N'), base, 'N', true)).toMatchObject({ text: 'Same platform', spoken: 'Same platform.' })
  })

  it('notes an unknown elevator status only when status is unknown and a route offered rides one', () => {
    expect(transferLineView(choice(), base, 'N', false).note).toBe('elevator status unknown')
    expect(transferLineView(choice(), base, 'N', false).spoken).toContain('Elevator status unknown.')
    const stairsOnly = without(base, 'EL-T', 'EL-U')
    expect(transferLineView(choice(stairsOnly), stairsOnly, 'N', false).note).toBeNull()
  })

  it('says there is no step-free way when the layout has none, and nothing when an outage took it', () => {
    const noLift = without(base, 'EL-T')
    const v = transferLineView(choice(noLift), noLift, 'N', true)
    expect(v.stepFree).toBe('No step-free way')
    expect(v.spoken).toBe('Take the stairs up to the N platform. No step-free way in this layout.')
    const out = transferLineView(choice(base, 'U01N', 'T01S', new Set(['EL-T'])), base, 'N', true)
    expect(out).toMatchObject({ stepFree: null, spoken: 'Take the stairs up to the N platform.' })
  })

  it('says probably on an estimated layout, on the instruction and on the step-free way', () => {
    const i = { ...base, approximate: true as const }
    const v = transferLineView(choice(i), i, 'N', true)
    expect(v).toMatchObject({ probably: true, note: null, stepFree: 'Step-free: elevators via the U mezzanine and the T mezzanine · probably' })
    expect(v.spoken).toBe(
      'Take the stairs up to the N platform. Probably: the station layout is estimated. Step-free: elevators via the U mezzanine and the T mezzanine, probably.',
    )
  })

  it('says why when only an assumed fare control makes it probable', () => {
    const i = withSlab(withSlab(without(base, 'st-tu'), 'mezz-u', { paid: undefined }), 'mezz-t', { paid: undefined })
    const v = transferLineView(choice(i), i, 'N', true)
    expect(v.probably).toBe(true)
    expect(v.spoken).toContain('Probably: fare control is assumed.')
    // Platform to platform, the quickest assumes nothing, but its step-free way through the unstated slabs does.
    const direct = withSlab(base, 'mezz-u', { paid: undefined })
    expect(transferLineView(choice(direct), direct, 'N', true)).toMatchObject({ probably: false, stepFree: 'Step-free: elevators via the U mezzanine and the T mezzanine · probably' })
  })
})
