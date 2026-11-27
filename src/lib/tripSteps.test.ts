import { describe, expect, it } from 'vitest'
import type { StationLayout } from '../data/interiorLoad'
import type { PlaceWalkInfos } from './placeWalk'
import { activeStepKey, journeyItinerary, stepStatus, type ItineraryRow, type StepContext, type TripStep } from './tripSteps'
import type { ChangeLegView, RideLegView, WalkLegView } from './tripView'

const ride = (routeId: string, from: [string, string, string], to: [string, string, string], tripId = `${routeId}-trip`): RideLegView => ({
  kind: 'ride',
  routeId,
  tripId,
  live: false,
  headsign: 'Somewhere',
  board: { stationId: from[0], name: from[1], clock: from[2] },
  alight: { stationId: to[0], name: to[1], clock: to[2] },
  stopsText: '3 stops',
})
const change = (stationId: string, name: string, minutes: number | null, transferKey = 'k'): ChangeLegView => ({ kind: 'change', stationId, name, minutes, transferKey })
const walk = (toStationId: string, to: string): WalkLegView => ({ kind: 'walk', from: 'Origin St', toStationId, to, minutes: 5 })

const ctx = (over: Partial<StepContext> & { layouts?: Record<string, StationLayout> } = {}): StepContext => {
  const { layouts = {}, ...rest } = over
  return {
    layoutOf: (id) => (id in layouts ? layouts[id]! : 'generated'),
    routeName: (id) => id,
    routeSpoken: (id) => id,
    hasBoardPath: false,
    hasExitPath: () => false,
    hasTransferPath: () => false,
    fixPending: null,
    noWayIn: false,
    placeWalks: { from: null, to: null },
    ...rest,
  }
}

const steps = (rows: ItineraryRow[]): TripStep[] => rows.flatMap((r) => (r.kind === 'step' ? [r.step] : []))
const shape = (rows: ItineraryRow[]): string[] => rows.map((r) => (r.kind === 'step' ? r.step.key : r.kind === 'leg' ? `leg:${r.index}` : `place:${r.end}`))

const BEDFORD = ['L08', 'Bedford Av', '8:04'] as [string, string, string]
const UNION_OFF = ['L03', '14 St-Union Sq', '8:12'] as [string, string, string]
const UNION_ON = ['635', '14 St-Union Sq', '8:16'] as [string, string, string]
const TIMES = ['127', 'Times Sq-42 St', '8:31'] as [string, string, string]

const withChange = [ride('L', BEDFORD, UNION_OFF), change('635', '14 St-Union Sq', 4, 'L>4'), ride('4', UNION_ON, TIMES)]

describe('journeyItinerary', () => {
  it('steps Board, ride, Change, ride, Exit with "of 3" sentences', () => {
    const rows = journeyItinerary(withChange, ctx({ layouts: { L08: 'authored', '635': 'authored', '127': 'none' }, hasTransferPath: (k) => k === 'L>4' }))
    expect(shape(rows)).toEqual(['board:0', 'leg:0', 'change:1', 'leg:2', 'exit:2'])
    expect(steps(rows).map((s) => s.text)).toEqual(['Board 8:04 at Bedford Av', 'Change at 14 St-Union Sq · 4 min walk · 4 train at 8:16', 'Exit 8:31 at Times Sq-42 St'])
    expect(steps(rows).map((s) => s.spoken)).toEqual([
      'Step 1 of 3: board the L at Bedford Av, 8:04.',
      'Step 2 of 3: change at 14 St-Union Sq to the 4 train at 8:16, a 4-minute walk.',
      'Step 3 of 3: exit at Times Sq-42 St, 8:31. No station layout.',
    ])
  })

  it('says when a ride gets off, except before the Exit step, which has the time', () => {
    const rows = journeyItinerary(withChange, ctx())
    expect(rows.filter((r) => r.kind === 'leg').map((r) => r.kind === 'leg' && r.showOff)).toEqual([true, false])
  })

  it('names the station a ride gets off at only when a walk follows, since a step names it otherwise', () => {
    const rows = journeyItinerary([ride('L', BEDFORD, UNION_OFF), walk('R20', '14 St'), ride('N', ['R20', '14 St', '8:20'], TIMES)], ctx())
    const offs = rows.flatMap((r) => (r.kind === 'leg' && r.leg.kind === 'ride' ? [r.offPlace] : []))
    expect(offs).toEqual(['14 St-Union Sq', null])
    expect(journeyItinerary(withChange, ctx()).flatMap((r) => (r.kind === 'leg' ? [r.offPlace] : []))).toEqual([null, null])
  })

  it('has two steps for a journey with no change', () => {
    const rows = journeyItinerary([ride('L', BEDFORD, TIMES)], ctx())
    expect(shape(rows)).toEqual(['board:0', 'leg:0', 'exit:0'])
    expect(steps(rows).map((s) => s.spoken.slice(0, 15))).toEqual(['Step 1 of 2: bo', 'Step 2 of 2: ex'])
  })

  it('puts leading and trailing walks around the steps', () => {
    const rows = journeyItinerary([walk('L08', 'Bedford Av'), ride('L', BEDFORD, UNION_OFF), walk('X', 'Somewhere')], ctx())
    expect(shape(rows)).toEqual(['leg:0', 'board:1', 'leg:1', 'exit:1', 'leg:2'])
  })

  it('makes a walk between two stations its own row followed by a Board step at the next ride', () => {
    const rows = journeyItinerary([ride('L', BEDFORD, UNION_OFF), walk('R20', '14 St'), ride('N', ['R20', '14 St', '8:20'], TIMES)], ctx())
    expect(shape(rows)).toEqual(['board:0', 'leg:0', 'leg:1', 'board:2', 'leg:2', 'exit:2'])
    expect(steps(rows).map((s) => s.stationId)).toEqual(['L08', 'R20', '127'])
    expect(steps(rows)[1]!.spoken).toBe('Step 2 of 3: board the N at 14 St, 8:20.')
  })

  it('has no steps for a walk-only journey', () => {
    const rows = journeyItinerary([walk('L08', 'Bedford Av')], ctx())
    expect(shape(rows)).toEqual(['leg:0'])
  })

  it('omits the minutes of a same-platform change', () => {
    const rows = journeyItinerary([ride('L', BEDFORD, UNION_OFF), change('635', '14 St-Union Sq', null), ride('4', UNION_ON, TIMES)], ctx())
    const step = steps(rows)[1]!
    expect(step.text).toBe('Change at 14 St-Union Sq · 4 train at 8:16')
    expect(step.spoken).toBe('Step 2 of 3: change at 14 St-Union Sq to the 4 train at 8:16. No path shown for this change.')
  })

  it('carries the keys the panel looks the lines up by', () => {
    const [board, chg, exit] = steps(journeyItinerary(withChange, ctx()))
    expect([board!.transferKey, board!.tripId]).toEqual([null, null])
    expect(chg!.transferKey).toBe('L>4')
    expect(exit!.tripId).toBe('4-trip')
  })

  it('keeps the exit line off a ride that a walk follows: the way out is at the walk\'s end, not its alight station', () => {
    const rows = journeyItinerary([ride('L', BEDFORD, UNION_OFF), walk('X', 'Somewhere')], ctx({ layouts: { L03: 'authored' }, hasExitPath: () => true }))
    const exit = steps(rows).at(-1)!
    expect(exit.kind).toBe('exit')
    expect(exit.tripId).toBeNull()
    expect(exit.status).toBeNull()
    const lone = steps(journeyItinerary([ride('L', BEDFORD, UNION_OFF)], ctx({ hasExitPath: () => true }))).at(-1)!
    expect(lone.tripId).toBe('L-trip')
  })

  it('gives the first Board the board path only', () => {
    const rows = journeyItinerary([ride('L', BEDFORD, UNION_OFF), walk('R20', '14 St'), ride('N', ['R20', '14 St', '8:20'], TIMES)], ctx({ layouts: { L08: 'none', R20: 'none' }, hasBoardPath: true }))
    expect(steps(rows).map((s) => s.status)).toEqual([null, 'No station layout', null])
  })
})

describe('a trip end from the location fix, and a layout with no way in', () => {
  const journey = [ride('L', BEDFORD, TIMES)]
  it('asks for a tap at the fix-filled end with a layout, also in the sentence', () => {
    const [board, exit] = steps(journeyItinerary(journey, ctx({ fixPending: 'from' })))
    expect(board!.status).toBe('Tap to show the way in')
    expect(board!.spoken).toBe('Step 1 of 2: board the L at Bedford Av, 8:04. Tap to show the way in.')
    expect(exit!.status).toBeNull()
    const [, out] = steps(journeyItinerary(journey, ctx({ fixPending: 'to' })))
    expect(out!.status).toBe('Tap to show the way out')
    expect(out!.spoken).toContain('Tap to show the way out.')
  })
  it('says there is no layout instead where there is none, and nothing while the index loads', () => {
    expect(steps(journeyItinerary(journey, ctx({ fixPending: 'from', layouts: { L08: 'none' } })))[0]!.status).toBe('No station layout')
    expect(steps(journeyItinerary(journey, ctx({ fixPending: 'from', layouts: { L08: null } })))[0]!.status).toBeNull()
  })
  it('says the layout has no way in, at the From station only', () => {
    expect(steps(journeyItinerary(journey, ctx({ noWayIn: true })))[0]!.status).toBe('No way in on the layout')
    // A journey that walks to its first train boards elsewhere.
    const walked = journeyItinerary([walk('L08', 'Bedford Av'), ride('L', BEDFORD, TIMES)], ctx({ noWayIn: true, fixPending: 'from' }))
    expect(steps(walked)[0]!.status).toBeNull()
  })
})

describe('stepStatus', () => {
  it('is silent while the layout is unknown or a path exists', () => {
    expect(stepStatus('exit', null, false)).toBeNull()
    expect(stepStatus('change', 'none', true)).toBeNull()
  })
  it('says there is no layout where there is none', () => {
    expect(stepStatus('board', 'none', false)).toBe('No station layout')
    expect(stepStatus('exit', 'none', false)).toBe('No station layout')
    expect(stepStatus('change', 'none', false)).toBe('No station layout')
  })
  it('says a change at a generated station has no drawable path, but stays quiet for Board and Exit there', () => {
    expect(stepStatus('change', 'generated', false)).toBe('No path shown for this change')
    expect(stepStatus('board', 'generated', false)).toBeNull()
    expect(stepStatus('exit', 'generated', false)).toBeNull()
  })
  it('stays quiet for an authored station with no path yet', () => {
    expect(stepStatus('exit', 'authored', false)).toBeNull()
    expect(stepStatus('change', 'authored', false)).toBeNull()
  })
})

describe('journeyItinerary with place walks', () => {
  const one = [ride('L', BEDFORD, UNION_OFF)]
  const walks = (over: Partial<PlaceWalkInfos> = {}): PlaceWalkInfos => ({
    from: { place: 'Driggs Av & N 5 St', minutes: 3, estimated: false },
    to: { place: 'Bedford Av & N 4 St', minutes: 4, estimated: true },
    ...over,
  })
  const places = (rows: ItineraryRow[]) => rows.flatMap((r) => (r.kind === 'place' ? [r] : []))

  it('puts the From walk before the first row and the To walk after the last, as plain rows that are no steps', () => {
    const rows = journeyItinerary(one, ctx({ placeWalks: walks() }))
    expect(shape(rows)).toEqual(['place:from', 'board:0', 'leg:0', 'exit:0', 'place:to'])
    expect(steps(rows).map((s) => s.spoken.slice(0, 11))).toEqual(['Step 1 of 2', 'Step 2 of 2'])
  })

  it('words each row with the place, the minutes and "about" for an estimate, with a sentence naming the station', () => {
    const [from, to] = places(journeyItinerary(one, ctx({ placeWalks: walks() })))
    expect(from).toMatchObject({ end: 'from', text: 'Walk from Driggs Av & N 5 St · 3 min', spoken: 'Walk 3 minutes from Driggs Av & N 5 St to Bedford Av.' })
    expect(to).toMatchObject({ end: 'to', text: 'Walk to Bedford Av & N 4 St · about 4 min', spoken: 'Walk about 4 minutes from 14 St-Union Sq to Bedford Av & N 4 St.' })
  })

  it('says one minute in the singular, and adds no row for an end with no place walk', () => {
    const rows = journeyItinerary(one, ctx({ placeWalks: walks({ from: { place: 'Home', minutes: 1, estimated: false }, to: null }) }))
    expect(shape(rows)).toEqual(['place:from', 'board:0', 'leg:0', 'exit:0'])
    expect(places(rows)[0]!.spoken).toBe('Walk 1 minute from Home to Bedford Av.')
  })

  it('names the station from a trailing walk leg\'s end and a leading one\'s start', () => {
    const rows = journeyItinerary([walk('L03', '14 St-Union Sq'), ride('L', UNION_OFF, TIMES), walk('127', 'Times Sq-42 St')], ctx({ placeWalks: walks() }))
    const [from, to] = places(rows)
    expect(from!.spoken).toContain('to Origin St.')
    expect(to!.spoken).toContain('from Times Sq-42 St to')
  })
})

describe('activeStepKey', () => {
  const stored = { journeyKey: 'J', key: 'exit:2', leadId: '127' }
  it('is the step while the opened journey and the focused station match', () => {
    expect(activeStepKey(stored, 'J', '127')).toBe('exit:2')
  })
  it('ends with another journey open, another station focused, or none stored', () => {
    expect(activeStepKey(stored, 'K', '127')).toBeNull()
    expect(activeStepKey(stored, null, '127')).toBeNull()
    expect(activeStepKey(stored, 'J', '635')).toBeNull()
    expect(activeStepKey(stored, 'J', null)).toBeNull()
    expect(activeStepKey(null, 'J', '127')).toBeNull()
  })
})
