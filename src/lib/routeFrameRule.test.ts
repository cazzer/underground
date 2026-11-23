import { describe, expect, it } from 'vitest'
import { changeToken, isChangeToken, routeFrameDecision, routeIsFramed, type RouteInput, type RouteMemo, type RouteToken } from './routeFrameRule'

const A: RouteToken = { plan: 'L08>127#1', journey: 'L:a>b' }
const A2: RouteToken = { plan: 'L08>127#1', journey: 'L:c>d' }
const B: RouteToken = { plan: 'L08>127#2', journey: 'L:a>b' }
const fresh: RouteMemo = { framed: null, interrupted: false }
const input = (over: Partial<RouteInput> = {}): RouteInput => ({ route: A, silent: false, front: true, flying: null, following: false, gesture: false, ...over })

describe('routeFrameDecision', () => {
  it('flies when a plan settles', () => {
    expect(routeFrameDecision(fresh, input())).toBe('fly')
  })

  it('does nothing without a route or for the route already decided', () => {
    expect(routeFrameDecision(fresh, input({ route: null }))).toBe('none')
    expect(routeFrameDecision({ framed: A, interrupted: false }, input())).toBe('none')
    expect(routeFrameDecision({ framed: A, interrupted: false }, input({ silent: true }))).toBe('none')
  })

  it('skips a silent replan that swaps the journey', () => {
    expect(routeFrameDecision({ framed: A, interrupted: false }, input({ route: A2, silent: true }))).toBe('skip')
  })

  it('flies again for a journey the visitor opened, even after an interruption', () => {
    expect(routeFrameDecision({ framed: A, interrupted: true }, input({ route: A2 }))).toBe('fly')
  })

  it('flies when the visitor opens a journey from the list or goes back, even for the first journey', () => {
    const list: RouteToken = { plan: A.plan, journey: 'list:L:a>b' }
    const detail: RouteToken = { plan: A.plan, journey: 'detail:L:a>b' }
    expect(routeFrameDecision({ framed: list, interrupted: false }, input({ route: detail }))).toBe('fly')
    expect(routeFrameDecision({ framed: detail, interrupted: true }, input({ route: list }))).toBe('fly')
  })

  it('skips a silent refresh that drops the opened journey back to the list', () => {
    const list: RouteToken = { plan: A.plan, journey: 'list:L:a>b' }
    const detail: RouteToken = { plan: A.plan, journey: 'detail:L:c>d' }
    expect(routeFrameDecision({ framed: detail, interrupted: false }, input({ route: list, silent: true }))).toBe('skip')
  })

  it('flies for a new attempt of the plan', () => {
    expect(routeFrameDecision({ framed: A, interrupted: false }, input({ route: B }))).toBe('fly')
  })

  it('skips a new plan after the visitor moved the view while it loaded', () => {
    expect(routeFrameDecision({ framed: A, interrupted: true }, input({ route: B }))).toBe('skip')
    expect(routeFrameDecision({ framed: null, interrupted: true }, input())).toBe('skip')
  })

  it.each([
    ['the panel is not in front', { front: false }],
    ['a train is followed', { following: true }],
    ['a gesture is in progress', { gesture: true }],
    ['another flight is under way', { flying: 'other' as const }],
  ])('skips when %s', (_, over) => {
    expect(routeFrameDecision(fresh, input(over))).toBe('skip')
    expect(routeFrameDecision({ framed: A, interrupted: false }, input({ route: A2, ...over }))).toBe('skip')
  })

  it('flies again over its own flight', () => {
    expect(routeFrameDecision({ framed: A, interrupted: false }, input({ route: A2, flying: 'mine' }))).toBe('fly')
  })

  it('never fires later for a route that was skipped: once recorded as framed it is none', () => {
    const memo: RouteMemo = { framed: A, interrupted: false }
    expect(routeFrameDecision(memo, input({ front: true }))).toBe('none')
  })
})

describe('routeIsFramed', () => {
  it('is true only for the same plan and journey', () => {
    expect(routeIsFramed(A, { ...A })).toBe(true)
    expect(routeIsFramed(A, A2)).toBe(false)
    expect(routeIsFramed(A, B)).toBe(false)
    expect(routeIsFramed(A, null)).toBe(false)
    expect(routeIsFramed(null, A)).toBe(false)
  })
})

describe('change tokens', () => {
  const pick1 = changeToken('lmm:planned_work:35972#1')
  const pick2 = changeToken('lmm:planned_work:35972#2')
  it('are told apart from trip tokens', () => {
    expect(isChangeToken(pick1)).toBe(true)
    expect(isChangeToken(A)).toBe(false)
  })
  it('fly in front, even after a framed trip; skip while covered or followed', () => {
    expect(routeFrameDecision({ framed: A, interrupted: false }, input({ route: pick1 }))).toBe('fly')
    expect(routeFrameDecision(fresh, input({ route: pick1, front: false }))).toBe('skip')
    expect(routeFrameDecision(fresh, input({ route: pick1, following: true }))).toBe('skip')
  })
  it('frame each pick once; a new pick of the same row is a new token', () => {
    expect(routeFrameDecision({ framed: pick1, interrupted: false }, input({ route: pick1 }))).toBe('none')
    expect(routeFrameDecision({ framed: pick1, interrupted: false }, input({ route: pick2 }))).toBe('fly')
    expect(routeIsFramed(pick1, pick2)).toBe(false)
  })
})

/** Applies one decision as useRouteFlight does: anything but none records the route. */
function step(memo: RouteMemo, over: Partial<RouteInput>): ReturnType<typeof routeFrameDecision> {
  const d = routeFrameDecision(memo, input(over))
  if (d !== 'none') memo.framed = over.route === undefined ? A : over.route
  return d
}

describe('the trip under a picked change (the list in front: the trip decides with front false)', () => {
  it('a silent journey swap under the list is recorded, so closing the list frames nothing', () => {
    const memo: RouteMemo = { framed: A, interrupted: false }
    expect(step(memo, { route: A, front: false })).toBe('none')
    expect(step(memo, { route: A2, silent: true, front: false })).toBe('skip')
    expect(step(memo, { route: A2, front: true })).toBe('none')
  })
  it('a plan that first settles under the list never fires later', () => {
    const memo: RouteMemo = { framed: A, interrupted: false }
    expect(step(memo, { route: B, front: false })).toBe('skip')
    expect(step(memo, { route: B, front: true })).toBe('none')
    const fresh2: RouteMemo = { framed: null, interrupted: false }
    expect(step(fresh2, { route: A, front: false })).toBe('skip')
    expect(step(fresh2, { route: A, front: true })).toBe('none')
  })
})
